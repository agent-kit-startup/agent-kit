/**
 * Driver mode for a dispatched L0 session (`agent-kit run-plan-all --events
 * ndjson`, driver protocol 1.2.0). The queue runner is one headless agent
 * session running the L0 command, not a tick loop: the events are
 * `run_start`, `agent_event` / `agent_text`, `hitl_gate`, `log` and
 * `run_end` (no `tick_start` / `tick_end`; `tick` is always 1). Answers,
 * stops and exit codes are the `run-plan` ones: the same answer reader, the
 * same agent sink, the same relay (`policy: "driver"`).
 *
 * No second tick dialect: the session runs the unchanged L0 prompt; the
 * driver only transports events and replies. Contract doc:
 * docs/driver-events-protocol.md ("Queue runner").
 */

import type { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { HANDOFF_REL } from "../utils/kit-paths.js";
import type { BackendId, BackendRunResult, VersionFn } from "./backends.js";
import type { WhichFn } from "./detect.js";
import { detectAgentBackend } from "./detect.js";
import {
  buildDispatchPrompt,
  ensureDispatchLogPath,
  readCommandFile,
  runHeadlessDispatch,
} from "./dispatch.js";
import {
  createDriverAnswerReader,
  createDriverEmitter,
  DRIVER_PROTOCOL_VERSION,
  DriverAgentSink,
  type DriverCommand,
  type DriverEmitter,
  type DriverQueueState,
  driverReplies,
  driverStop,
} from "./driver-events.js";
import { classifyGateExit, landGateExit } from "./gate-exit.js";
import { formatHitlSummary, hitlExitCode } from "./hitl-relay.js";
import { readRunQueueState } from "./plan-state.js";
import type { DriverRunOptions } from "./run-loop.js";

/** The one session of a dispatched driver run carries this tick number on its events. */
export const DISPATCH_DRIVER_TICK = 1;

/** How often the queue runner re-reads HANDOFF for `queue_state` changes. */
export const QUEUE_STATE_POLL_MS = 1000;

/**
 * `queue_state` fields from HANDOFF text: the same read-only projection as
 * Mission Control's Queue card (`readRunQueueState`). No queue (not yet
 * confirmed, or no HANDOFF) is all-null with `total: 0`.
 */
export function projectQueueState(handoff: string): DriverQueueState {
  const { queue, cursor, current, status } = readRunQueueState(handoff);
  if (queue.length === 0) return { cursor: null, total: 0, current: null, status: null };
  return { cursor, total: queue.length, current, status };
}

/** Reads HANDOFF; a missing or unreadable file is "no queue". */
export async function readQueueState(root: string): Promise<DriverQueueState> {
  let handoff = "";
  try {
    handoff = await readFile(path.join(root, HANDOFF_REL), "utf8");
  } catch {
    // no HANDOFF yet: no queue
  }
  return projectQueueState(handoff);
}

/**
 * Emits `queue_state` once at start and then whenever the projection
 * changes (polled: the agent edits HANDOFF in place or by rename, which
 * `fs.watch` does not report reliably). `flush()` re-reads once more so the
 * agent's last HANDOFF write before exit is not lost to the poll timing.
 */
export function createQueueStateWatcher(opts: {
  root: string;
  emitter: DriverEmitter;
  initial: DriverQueueState;
  pollMs?: number;
}): { flush(): Promise<void>; stop(): void } {
  let last = JSON.stringify(opts.initial);
  let busy: Promise<void> | null = null;
  let stopped = false;
  const check = async () => {
    const next = await readQueueState(opts.root);
    const key = JSON.stringify(next);
    if (key === last || stopped) return;
    last = key;
    opts.emitter.emit({ type: "queue_state", ...next });
  };
  const tick = () => {
    if (busy) return busy;
    busy = check().finally(() => {
      busy = null;
    });
    return busy;
  };
  opts.emitter.emit({ type: "queue_state", ...opts.initial });
  const timer = setInterval(() => {
    void tick();
  }, opts.pollMs ?? QUEUE_STATE_POLL_MS);
  timer.unref?.();
  return {
    flush: async () => {
      if (busy) await busy;
      await tick();
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export interface DispatchDriverOptions {
  root: string;
  /** The dispatched slash; only `run-plan-all` has a driver mode today. */
  slash: Extract<DriverCommand, "run-plan-all">;
  /** Requested backend (`auto` or an id); resolved like `agent-kit run`. */
  backend: string;
  model?: string;
  dryRun: boolean;
  noHitl?: boolean;
  landOnGate?: boolean;
  events: DriverRunOptions;
  whichFn?: WhichFn;
  /** Test seams passed through to the dispatch. */
  spawnFn?: typeof spawn;
  versionFn?: VersionFn;
  /** Test seam: HANDOFF poll interval for `queue_state` (default {@link QUEUE_STATE_POLL_MS}). */
  queuePollMs?: number;
}

/**
 * Land a dispatched session's gate stop or failure on a `gate-exit/<stamp>`
 * branch (`--land-on-gate`). Never changes the exit code, never answers the gate.
 */
export async function landDispatchOutcome(opts: {
  root: string;
  slash: string;
  backendId: BackendId;
  logPath: string;
  exitCode: number;
  result: BackendRunResult;
  log: (line: string) => void;
}): Promise<void> {
  const { result } = opts;
  const stop = result.hitl?.stop;
  const trigger = classifyGateExit({ stop, failed: opts.exitCode !== 0 });
  if (!trigger) return;
  const summary =
    result.lastResult?.resultText.trim() ||
    result.lastResult?.assistantTexts.at(-1)?.trim() ||
    undefined;
  try {
    await landGateExit({
      root: opts.root,
      outcome: {
        trigger,
        exitCode: opts.exitCode,
        reason: stop?.message ?? `${opts.backendId} exited with code ${opts.exitCode}`,
        command: `run ${opts.slash}`,
        backend: opts.backendId,
        logPath: opts.logPath,
        ...(stop ? { askId: stop.askId } : {}),
        ...(summary ? { summary } : {}),
        ...(result.lastResult
          ? {
              gateText: [result.lastResult.resultText, ...result.lastResult.assistantTexts].join(
                "\n",
              ),
            }
          : {}),
      },
      log: opts.log,
    });
  } catch (err) {
    opts.log(`gate-exit: landing failed: ${String(err)}`);
  }
}

/**
 * Run one dispatched L0 session in driver mode. stdout carries only NDJSON
 * events; every human line is a `log` event; the gate prompt text goes to
 * `writeErr`. Returns the run's exit code (0, 1 setup, 4 unanswered gate,
 * the agent's own non-zero code, 130 on SIGINT).
 */
export async function runDispatchDriver(opts: DispatchDriverOptions): Promise<number> {
  const root = path.resolve(opts.root);
  const emitter = createDriverEmitter(opts.events.write, opts.events.now);
  const reader = createDriverAnswerReader({
    input: opts.events.input,
    emitter,
    tick: () => DISPATCH_DRIVER_TICK,
  });
  const writeErr =
    opts.events.writeErr ??
    ((text: string) => {
      process.stderr.write(text);
    });
  const say = (message: string, level: "info" | "warn" | "error" = "info") =>
    emitter.emit({ type: "log", level, message });
  let ticks = 0;
  let queue: ReturnType<typeof createQueueStateWatcher> | null = null;
  const finish = async (
    exitCode: number,
    reason: string,
    result?: BackendRunResult,
  ): Promise<number> => {
    if (queue) {
      await queue.flush();
      queue.stop();
    }
    emitter.emit({
      type: "run_end",
      exitCode,
      ticks,
      pending: null,
      reason,
      planExhausted: false,
      replies: driverReplies(result?.hitl?.replies),
      stop: driverStop(result?.hitl?.stop),
    });
    reader.close();
    return exitCode;
  };

  const detected = await detectAgentBackend(opts.backend, opts.whichFn);
  if (!detected.ok) {
    say(detected.message, "error");
    return finish(1, detected.message);
  }
  const file = await readCommandFile(root, opts.slash);
  if (!file.ok) {
    say(file.message, "error");
    return finish(1, file.message);
  }
  const prompt = buildDispatchPrompt(file.body);

  const initialQueue = await readQueueState(root);
  emitter.emit({
    type: "run_start",
    protocol: DRIVER_PROTOCOL_VERSION,
    command: opts.slash,
    backend: detected.id,
    plan: null,
    pending: null,
    maxTicks: null,
    hitl: opts.noHitl ? "off" : "driver",
    queue: initialQueue,
  });
  queue = createQueueStateWatcher({
    root,
    emitter,
    initial: initialQueue,
    pollMs: opts.queuePollMs,
  });
  say(`Dispatch: ${opts.slash} via ${detected.id}`);
  say(`Command file: ${path.relative(root, file.path)}`);

  if (opts.dryRun) {
    say("--dry-run: no agent will be started. Prompt:");
    say(prompt);
    return finish(0, "dry-run");
  }

  const logPath = await ensureDispatchLogPath(root);
  say(`Log: ${path.relative(root, logPath)}`);

  const onSigInt = () => {
    queue?.stop();
    emitter.emit({
      type: "run_end",
      exitCode: 130,
      ticks,
      pending: null,
      reason: "interrupted (SIGINT)",
      planExhausted: false,
    });
    process.exit(130);
  };
  process.on("SIGINT", onSigInt);
  try {
    ticks = DISPATCH_DRIVER_TICK;
    let result: BackendRunResult;
    try {
      result = await runHeadlessDispatch({
        backendId: detected.id,
        bin: detected.bin,
        workspace: root,
        prompt,
        model: opts.model,
        logPath,
        spawnFn: opts.spawnFn,
        versionFn: opts.versionFn,
        log: (line) => say(line),
        render: new DriverAgentSink(emitter, DISPATCH_DRIVER_TICK),
        hitl: {
          policy: opts.noHitl ? "off" : "driver",
          readAnswer: reader.read,
          write: writeErr,
        },
      });
    } catch (err) {
      say(String(err), "error");
      return finish(1, `${opts.slash} failed to start: ${String(err)}`);
    }
    for (const line of formatHitlSummary(result.hitl)) say(line);
    const exitCode = hitlExitCode(result.exitCode, result.hitl);
    if (opts.landOnGate) {
      await landDispatchOutcome({
        root,
        slash: opts.slash,
        backendId: detected.id,
        logPath,
        exitCode,
        result,
        log: (line) => say(line, "warn"),
      });
    }
    const stop = result.hitl?.stop;
    const reason = stop
      ? stop.message
      : exitCode === 0
        ? "session ended"
        : `${detected.id} exited with code ${exitCode}`;
    return finish(exitCode, reason, result);
  } finally {
    process.off("SIGINT", onSigInt);
  }
}
