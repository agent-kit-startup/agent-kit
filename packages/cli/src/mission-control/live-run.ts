/**
 * Mission Control live mode for `agent-kit run` / `run-plan` / `run-plan-all`
 * (ADR 2026-09-19 point 5; ADR 2026-08-27 amended). Drives `runMcTuiLoop`
 * with an injected `loadView` that reads the in-memory `LiveRunFeed` instead
 * of a `dashboard-data.mjs` subprocess per frame, and answers HITL gates
 * through the input line. It never answers a gate itself: the only reply is
 * what the operator types; `q` or Ctrl-C outside a gate stops the run with an
 * operator record, Ctrl-C inside a gate is the relay's SIGINT stop. Terminal
 * state (raw mode, cursor) is restored on every exit path.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractHandoffNamedPlans, parsePlanFrontmatter } from "../plan-index/plan-index.js";
import type { HitlRunOptions, SpawnInfo } from "../plan-loop/backends.js";
import {
  type AnswerReader,
  type HitlGate,
  type RawAnswer,
  operatorQuitStop,
} from "../plan-loop/hitl-relay.js";
import { findActivePlanFile } from "../plan-loop/plan-state.js";
import type { StreamSink } from "../plan-loop/stream-render.js";
import { shouldUseWelcomeColor } from "../welcome/visual-kit.js";
import {
  LiveRunFeed,
  type McLiveChecklistRow,
  type McLiveMission,
  type McLiveView,
  emptyLiveMission,
} from "./live-feed.js";
import {
  type McTuiLoopHandle,
  type McTuiLoopHooks,
  type McTuiStdin,
  runMcTuiLoop,
} from "./loop.js";
import { InputLine, type McTuiRenderOptions, renderMcLive } from "./render.js";

/** Spinner cadence for the live loop (the feed is in memory; no subprocess per frame). */
export const LIVE_FRAME_MS = 120;
/** How often the plan and HANDOFF files are re-read for the progress bars. */
export const LIVE_PROGRESS_TTL_MS = 2000;

export interface LiveTuiGateOptions {
  /** `--plain`: status lines even on a TTY. */
  plain?: boolean;
  stdoutIsTTY?: boolean;
  stdinIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Live mode is the default on a real terminal: stdout and stdin are TTYs, no
 * `--plain`, and the visual-kit color gate is open (`NO_COLOR`, `CI`,
 * `NODE_DISABLE_COLORS`, `FORCE_COLOR=0` all fall back to status lines).
 */
export function shouldUseLiveTui(opts: LiveTuiGateOptions = {}): boolean {
  if (opts.plain) return false;
  const env = opts.env ?? process.env;
  const stdoutIsTTY = opts.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  const stdinIsTTY = opts.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  if (!stdoutIsTTY || !stdinIsTTY) return false;
  return shouldUseWelcomeColor({ stdoutIsTTY, env });
}

export interface LiveMissionState {
  mission: McLiveMission;
  checklist: McLiveChecklistRow[];
}

export interface LiveMissionIo {
  readFile: (file: string) => Promise<string | null>;
  findActivePlan: (plansDir: string) => Promise<string | null>;
}

function defaultMissionIo(): LiveMissionIo {
  return {
    readFile: async (file) => {
      try {
        return await readFile(file, "utf8");
      } catch {
        return null;
      }
    },
    findActivePlan: findActivePlanFile,
  };
}

const QUEUE_CURSOR_RE = /^- \*\*Queue cursor:\*\*\s*(.+)$/m;
const QUEUE_STATUS_RE = /^- \*\*Queue status:\*\*\s*(.+)$/m;
const MODE_RE = /^- \*\*Mode:\*\*\s*(.+)$/m;
const QUEUE_DONE_STATUSES = new Set(["exhausted", "completed", "done"]);

function firstWord(raw: string | undefined): string | null {
  const word = raw?.trim().split(/\s+/)[0]?.replace(/[`*]/g, "");
  return word ? word : null;
}

/**
 * Read-only projection of the HANDOFF queue fields and the current plan's
 * frontmatter onto the Mission panel. The CLI never advances the cursor
 * (ADR 2026-09-19 point 3); it only paints what the file says.
 */
export async function readLiveMission(
  root: string,
  io: LiveMissionIo = defaultMissionIo(),
): Promise<LiveMissionState> {
  const mission = emptyLiveMission();
  const handoff = (await io.readFile(path.join(root, ".cursor", "HANDOFF.md"))) ?? "";
  const named = extractHandoffNamedPlans(handoff);
  mission.mode = firstWord(MODE_RE.exec(handoff)?.[1]);

  let cursorIndex: number | null = null;
  let cursorPlan: string | null = null;
  const cursorRaw = QUEUE_CURSOR_RE.exec(handoff)?.[1]?.trim() ?? "";
  const indexMatch = /^(\d+)\b/.exec(cursorRaw);
  if (indexMatch?.[1]) cursorIndex = Number(indexMatch[1]);
  const currentMatch = /current:\s*`?([^`()]+?)`?\s*\)/i.exec(cursorRaw);
  if (currentMatch?.[1]) {
    const base = currentMatch[1].trim().split("/").pop() ?? "";
    if (/\.plan\.md$/i.test(base)) cursorPlan = base;
  }
  const queueStatus = firstWord(QUEUE_STATUS_RE.exec(handoff)?.[1]);
  const queue = named.runQueue;
  const finished = queueStatus !== null && QUEUE_DONE_STATUSES.has(queueStatus.toLowerCase());
  let checklist: McLiveChecklistRow[] = [];
  if (queue.length > 0) {
    let cursor: number | null = null;
    if (cursorIndex !== null && cursorIndex >= 0 && cursorIndex < queue.length) {
      cursor = cursorIndex;
    } else if (cursorPlan && queue.includes(cursorPlan)) {
      cursor = queue.indexOf(cursorPlan);
    }
    const done = finished ? queue.length : (cursor ?? 0);
    mission.queue = {
      done,
      total: queue.length,
      current: cursor !== null ? (queue[cursor] ?? null) : cursorPlan,
      status: queueStatus,
    };
    checklist = queue.map((file, i) => ({
      label: file,
      state:
        finished || (cursor !== null && i < cursor) ? "done" : i === cursor ? "current" : "pending",
    }));
  }

  const plansDir = path.join(root, ".cursor", "plans");
  // A finished queue no longer names the plan being worked; the HANDOFF Plan field does.
  const planBase = (mission.queue && !finished ? mission.queue.current : null) ?? named.active;
  const planPath = planBase ? path.join(plansDir, planBase) : await io.findActivePlan(plansDir);
  if (planPath) {
    const raw = await io.readFile(planPath);
    if (raw !== null) {
      mission.planFile = path.basename(planPath);
      const { todos } = parsePlanFrontmatter(raw);
      const open = todos.filter((t) => t.status !== "cancelled");
      mission.todos = {
        done: open.filter((t) => t.status === "completed").length,
        total: open.length,
      };
      mission.currentTodo = todos.find((t) => t.status === "in_progress")?.id ?? null;
      mission.nextTodo = todos.find((t) => t.status === "pending")?.id ?? null;
      if (checklist.length === 0) {
        checklist = open.map((t) => ({
          label: t.id,
          state:
            t.status === "completed" ? "done" : t.status === "in_progress" ? "current" : "pending",
        }));
        const current = checklist.findIndex((row) => row.state === "current");
        if (current > 1) checklist = checklist.slice(current - 1);
      }
    }
  }
  return { mission, checklist };
}

/** Throttled reader: the files are re-read at most once per `ttlMs`. */
export function createLiveMissionLoader(
  root: string,
  opts: { io?: LiveMissionIo; ttlMs?: number; now?: () => number } = {},
): () => Promise<LiveMissionState> {
  const ttl = opts.ttlMs ?? LIVE_PROGRESS_TTL_MS;
  const now = opts.now ?? Date.now;
  let cached: LiveMissionState | null = null;
  let readAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<LiveMissionState> | null = null;
  return async () => {
    if (cached && now() - readAt < ttl) return cached;
    if (inFlight) return inFlight;
    inFlight = readLiveMission(root, opts.io)
      .then((state) => {
        cached = state;
        readAt = now();
        return state;
      })
      .finally(() => {
        inFlight = null;
      });
    return cached ?? inFlight;
  };
}

/** What the run lane hands to the backend so the TUI owns the terminal. */
export interface LiveRunSeams {
  render: StreamSink;
  hitl: HitlRunOptions;
  onSpawn: (info: SpawnInfo) => void;
  /** Operator tips (backend `log` seam) go to the Flight Log. */
  log: (line: string) => void;
}

export interface WithLiveTuiOptions {
  root: string;
  backend: string;
  logPath: string;
  /** `--no-hitl`: a gate stops the run, no input line. */
  noHitl?: boolean;
  /** Test seams. Defaults: process.stdin / process.stdout / process.env. */
  stdin?: McTuiStdin;
  write?: (chunk: string) => void;
  columns?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
  intervalMs?: number;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  missionLoader?: () => Promise<LiveMissionState>;
  /** Register process SIGINT / SIGTERM handlers (default: true). */
  signals?: boolean;
  /** Test seam: observe the feed. */
  onFeed?: (feed: LiveRunFeed) => void;
}

interface PendingGate {
  gate: HitlGate;
  settle: (answer: RawAnswer) => void;
}

/**
 * Run `run` with the Mission Control live view owning the terminal. The
 * returned value is `run`'s; the caller prints the HITL summary afterwards
 * so stamps and the stop record are in scrollback below the last frame.
 */
export async function withLiveTui<T>(
  opts: WithLiveTuiOptions,
  run: (seams: LiveRunSeams) => Promise<T>,
): Promise<T> {
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk));
  const stdin = opts.stdin ?? process.stdin;
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const columns = opts.columns ?? process.stdout.columns ?? 80;
  const rows = opts.rows ?? process.stdout.rows ?? 24;
  const feed = new LiveRunFeed({
    columns,
    now,
    backend: opts.backend,
    logPath: path.relative(opts.root, opts.logPath) || opts.logPath,
  });
  opts.onFeed?.(feed);
  const missionLoader = opts.missionLoader ?? createLiveMissionLoader(opts.root, { now });
  const input = new InputLine();

  let pending: PendingGate | null = null;
  let spawnInfo: SpawnInfo | null = null;
  let quitRequested: ReturnType<typeof operatorQuitStop> | null = null;
  let handle: McTuiLoopHandle | null = null;

  const repaint = () => {
    void handle?.repaint();
  };

  const settleGate = (answer: RawAnswer) => {
    const open = pending;
    if (!open) return;
    pending = null;
    feed.closeGate();
    open.settle(answer);
  };

  const readAnswer: AnswerReader = (gate, readOpts) =>
    new Promise<RawAnswer>((resolve) => {
      const onAbort = () => settleGate({ kind: "eof" });
      if (readOpts.signal?.aborted) {
        resolve({ kind: "eof" });
        return;
      }
      input.reset();
      pending = {
        gate,
        settle: (answer) => {
          readOpts.signal?.removeEventListener("abort", onAbort);
          resolve(answer);
        },
      };
      readOpts.signal?.addEventListener("abort", onAbort, { once: true });
      feed.openGate(gate);
      repaint();
    });

  const stopRun = (stop: ReturnType<typeof operatorQuitStop>) => {
    if (pending) {
      settleGate({ kind: "sigint" });
      return;
    }
    if (quitRequested) return;
    quitRequested = stop;
    feed.setPhase("stopping");
    feed.note(stop.message);
    spawnInfo?.stop(stop);
  };

  const hooks: McTuiLoopHooks = {
    write,
    stdin,
    now,
    setIntervalFn: opts.setIntervalFn,
    clearIntervalFn: opts.clearIntervalFn,
    onKey: (chunk) => {
      if (!pending) return false;
      const result = input.handleKey(chunk);
      if (result === "submit") settleGate({ kind: "line", text: input.value });
      else if (result === "sigint") settleGate({ kind: "sigint" });
      else if (result === "eof") settleGate({ kind: "eof" });
      else if (result === "edit") repaint();
      return true;
    },
    onQuit: (key) => {
      write("\n");
      stopRun(operatorQuitStop(key));
    },
  };

  const loadView = async (): Promise<McLiveView> => {
    const state = await missionLoader();
    return {
      mission: state.mission,
      checklist: state.checklist,
      gate: pending
        ? {
            askId: pending.gate.askId,
            labels: pending.gate.labels,
            detection: pending.gate.detection,
            input,
          }
        : null,
      flightLog: feed.log,
      crew: feed.crew,
      error: null,
    };
  };

  const seams: LiveRunSeams = {
    render: feed,
    log: (line) => feed.note(line),
    onSpawn: (info) => {
      spawnInfo = info;
      feed.setProcess({ backend: info.backend, pid: info.pid });
      if (quitRequested) info.stop(quitRequested);
    },
    hitl: {
      policy: opts.noHitl ? "off" : "prompt",
      isTTY: true,
      readAnswer,
      write: (text) => feed.note(text, "hitl"),
    },
  };

  const onSignal = (signal: "SIGINT" | "SIGTERM") => {
    handle?.stop();
    stopRun(operatorQuitStop(signal));
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  const signals = opts.signals ?? true;
  if (signals) {
    process.prependListener("SIGINT", onSigint);
    process.prependListener("SIGTERM", onSigterm);
  }

  try {
    handle = await runMcTuiLoop<McLiveView>({
      loadView,
      render: (view, renderOpts: McTuiRenderOptions) =>
        renderMcLive(view, { ...renderOpts, columns, rows, now: now() }),
      stdoutIsTTY: true,
      env,
      intervalMs: opts.intervalMs ?? LIVE_FRAME_MS,
      renderOpts: { stdoutIsTTY: true, env, columns },
      hooks,
    });
    const result = await run(seams);
    feed.setPhase("done");
    if (handle) await handle.repaint();
    return result;
  } finally {
    if (pending) settleGate({ kind: "eof" });
    handle?.stop();
    if (signals) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
    write("\n");
  }
}
