import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { defineCommand } from "citty";
import {
  CLAUDE_MAX_BUDGET_USD_ENV,
  CLAUDE_MAX_TURNS_ENV,
  RedactingStreamBuffer,
  redactSecrets,
} from "../plan-loop/backends.js";
import type { WhichFn } from "../plan-loop/detect.js";
import { detectAgentBackend, listDetectBackendIds } from "../plan-loop/detect.js";
import {
  classifySlash,
  normalizeSlashName,
  promoteBlockedMessage,
  unknownSlashMessage,
} from "../plan-loop/dispatch.js";
import {
  defaultExec,
  type ExecFn,
  GATE_EXIT_MARKER_RELPATH,
  type GateExitOutcome,
  gateExitRedactions,
  gateExitStamp,
  type LandGateExitOptions,
  type LandGateExitResult,
  landGateExit,
  listGateExitBranches,
  readGateExitMarker,
  resolveGateExitRefs,
  writeGateExitMarker,
} from "../plan-loop/gate-exit.js";
import { HITL_UNANSWERED_EXIT_CODE } from "../plan-loop/hitl-relay.js";
import {
  parseReviewPackMaxBytes,
  REVIEW_BACKENDS,
  REVIEW_PACK_DEFAULT_MAX_BYTES,
  REVIEW_PACK_SLASH,
  reviewBackendMessage,
} from "../plan-loop/review-job.js";
import { ensureLoopLogsDir, runnerStatePaths } from "../utils/kit-paths.js";
import { logger } from "../utils/logger.js";

/**
 * Countdown: the gate-aware one-shot launcher (ADR
 * 2026-10-08_countdown-coming-home-generic-lane point 1). An external timer
 * (cron, a systemd timer, a CI schedule) invokes it; it is never a daemon and
 * never a second tick dialect. Each fire fetches, refuses to start while a
 * gate exit is pending, on a dirty root tree, or while an unmerged gate-exit
 * branch has no marker, then runs exactly one existing headless dispatch as a
 * child (`run-plan`, `run <slash>` or the review job `run review-pack`, always
 * with `--no-hitl --land-on-gate`)
 * under a wall-clock window and a stall timer. A window overrun or a stall is
 * Circuit's Dead: the child is stopped (SIGTERM, then SIGKILL) and the cause
 * lands in the log and in a gate-exit note. A gate is never answered.
 */

export const COUNTDOWN_EXIT = {
  completed: 0,
  usage: 1,
  /** A gate exit is pending, or the run reached a gate. */
  pending: 2,
  /** Circuit's Dead: failed, stalled, over the window, dirty tree, fetch failed. */
  circuitsDead: 3,
} as const;

export const COUNTDOWN_JOBS = ["tick", "dispatch", "review"] as const;
export type CountdownJob = (typeof COUNTDOWN_JOBS)[number];

export const COUNTDOWN_DEFAULT_MAX_TICKS = 1;
export const COUNTDOWN_DEFAULT_WINDOW_MIN = 120;
export const COUNTDOWN_DEFAULT_STALL_MIN = 20;
/** ms between SIGTERM and SIGKILL when Circuit's Dead stops the child. */
export const COUNTDOWN_KILL_GRACE_MS = 30_000;

export type CircuitsDeadCause = "window" | "stall";

/** One running child job; the seam the tests replace with a fake child. */
export interface JobHandle {
  /** Receives every stdout/stderr chunk (decoded text). */
  onData(listener: (text: string) => void): void;
  kill(signal: NodeJS.Signals): void;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export type SpawnJob = (
  args: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => JobHandle;

/**
 * Spawn this CLI again (`node <cli entry> <args>`) in its own process group,
 * so a kill reaches the agent binary the child started as well.
 */
export const defaultSpawnJob: SpawnJob = (args, opts) => {
  const entry = process.argv[1] ?? "";
  const group = process.platform !== "win32";
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: opts.cwd,
    env: opts.env,
    detached: group,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const listeners: Array<(text: string) => void> = [];
  const emit = (text: string) => {
    for (const l of listeners) l(text);
  };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (t: string) => emit(t));
  child.stderr?.on("data", (t: string) => emit(t));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("error", (err) => {
      emit(`countdown: could not start the job: ${String(err)}\n`);
      resolve({ code: 1, signal: null });
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return {
    onData: (listener) => listeners.push(listener),
    kill: (signal) => {
      try {
        if (group && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    },
    exited,
  };
};

export interface SuperviseOptions {
  windowMs: number;
  stallMs: number;
  killGraceMs: number;
  onData?: (text: string) => void;
  onCircuitsDead?: (cause: CircuitsDeadCause) => void;
}

export interface SuperviseResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  circuitsDead: CircuitsDeadCause | null;
}

/**
 * Wait for the child under two caps. Any output is a stream event and
 * resets the stall timer. On a window overrun or a stall the child gets
 * SIGTERM, then SIGKILL after the grace period.
 */
export async function superviseJob(
  handle: JobHandle,
  opts: SuperviseOptions,
): Promise<SuperviseResult> {
  let dead: CircuitsDeadCause | null = null;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = (cause: CircuitsDeadCause) => {
    if (dead) return;
    dead = cause;
    opts.onCircuitsDead?.(cause);
    handle.kill("SIGTERM");
    killTimer = setTimeout(() => handle.kill("SIGKILL"), opts.killGraceMs);
  };
  const windowTimer = setTimeout(() => stop("window"), opts.windowMs);
  let stallTimer = setTimeout(() => stop("stall"), opts.stallMs);
  handle.onData((text) => {
    opts.onData?.(text);
    if (dead) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stop("stall"), opts.stallMs);
  });
  try {
    const exit = await handle.exited;
    return { ...exit, circuitsDead: dead };
  } finally {
    clearTimeout(windowTimer);
    clearTimeout(stallTimer);
    if (killTimer) clearTimeout(killTimer);
  }
}

/**
 * Countdown exit code from the child's end: 0 completed; 2 when the child
 * stopped at a gate (inner `--no-hitl` exit 4) or left a new gate exit
 * pending; 3 (Circuit's Dead) for a window overrun, a stall, a signal or any
 * other failure. Countdown never returns 4 itself.
 */
export function countdownExitCode(input: {
  code: number | null;
  circuitsDead: CircuitsDeadCause | null;
  pendingGrew: boolean;
}): number {
  if (input.circuitsDead) return COUNTDOWN_EXIT.circuitsDead;
  if (input.code === 0) return input.pendingGrew ? COUNTDOWN_EXIT.pending : 0;
  if (input.code === HITL_UNANSWERED_EXIT_CODE) return COUNTDOWN_EXIT.pending;
  return COUNTDOWN_EXIT.circuitsDead;
}

/** Arguments of the one headless job a fire runs (always `--no-hitl --land-on-gate`). */
export function countdownChildArgs(input: {
  job: CountdownJob;
  slash?: string;
  backend: string;
  maxTicks: number;
  model?: string;
  /** Review job only: the diff pack ceiling in bytes. */
  maxPackBytes?: number;
  /** Review job only: review branches unchanged since the last review too. */
  includeReviewed?: boolean;
}): string[] {
  const head =
    input.job === "tick"
      ? ["run-plan"]
      : input.job === "review"
        ? ["run", REVIEW_PACK_SLASH]
        : ["run", normalizeSlashName(input.slash ?? "")];
  return [
    ...head,
    "--backend",
    input.backend,
    ...(input.job === "review"
      ? [
          "--max-pack-bytes",
          String(input.maxPackBytes ?? REVIEW_PACK_DEFAULT_MAX_BYTES),
          ...(input.includeReviewed ? ["--include-reviewed"] : []),
        ]
      : ["--max-ticks", String(input.maxTicks)]),
    "--no-hitl",
    "--land-on-gate",
    "--plain",
    ...(input.model ? ["--model", input.model] : []),
  ];
}

export type PreflightResult =
  | { ok: true; pendingBefore: number; base: string }
  | { ok: false; exitCode: number; reason: string };

/**
 * The refusals that run before any agent starts, in ADR order: fetch, a
 * pending gate exit (records `skipped <stamp>`), a dirty root tree, an
 * unmerged gate-exit branch with no marker entry.
 */
export async function countdownPreflight(opts: {
  root: string;
  env: NodeJS.ProcessEnv;
  exec: ExecFn;
  now: Date;
  log: (line: string) => void;
}): Promise<PreflightResult> {
  const git = (args: readonly string[]) =>
    opts.exec("git", args, { cwd: opts.root, env: opts.env });
  const first = (text: string) => text.trim().split("\n")[0] ?? "";

  const top = await git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    return { ok: false, exitCode: COUNTDOWN_EXIT.usage, reason: "not a git repository" };
  }

  const origin = await git(["remote", "get-url", "origin"]);
  const hasOrigin = origin.code === 0 && origin.stdout.trim().length > 0;
  if (hasOrigin) {
    const fetched = await git(["fetch", "--prune", "--quiet", "origin"]);
    if (fetched.code !== 0) {
      return {
        ok: false,
        exitCode: COUNTDOWN_EXIT.circuitsDead,
        reason: `Circuit's Dead: git fetch --prune failed (${first(fetched.stderr)}); pending gate-exit branches cannot be checked`,
      };
    }
    opts.log("fetched origin (--prune)");
  } else {
    opts.log("no `origin` remote: nothing fetched; checking local gate-exit branches");
  }

  const marker = await readGateExitMarker(opts.root);
  if (marker.kind === "invalid") {
    return {
      ok: false,
      exitCode: COUNTDOWN_EXIT.pending,
      reason: `${GATE_EXIT_MARKER_RELPATH} is unreadable (${marker.detail}); not starting into an unknown gate state`,
    };
  }
  const pending = marker.kind === "ok" ? marker.marker.pending : [];
  if (marker.kind === "ok" && pending.length > 0) {
    const skipped = `skipped ${gateExitStamp(opts.now)}`;
    try {
      await writeGateExitMarker(opts.root, {
        ...marker.marker,
        skipped: [...marker.marker.skipped, skipped],
      });
      opts.log(`recorded \`${skipped}\` in ${GATE_EXIT_MARKER_RELPATH}`);
    } catch (err) {
      opts.log(`could not record the skipped run in ${GATE_EXIT_MARKER_RELPATH}: ${String(err)}`);
    }
    const stamps = pending.map((e) => e.stamp).join(", ");
    return {
      ok: false,
      exitCode: COUNTDOWN_EXIT.pending,
      reason: `gate exit pending (${stamps}); triage it before the next run`,
    };
  }

  const status = await git(["status", "--porcelain"]);
  const dirty = status.stdout.split("\n").filter((l) => l.trim()).length;
  if (status.code !== 0 || dirty > 0) {
    return {
      ok: false,
      exitCode: COUNTDOWN_EXIT.circuitsDead,
      reason:
        status.code !== 0
          ? `Circuit's Dead: git status failed (${first(status.stderr)})`
          : `Circuit's Dead: the working tree is dirty (${dirty} path(s)); reported, not cleaned`,
    };
  }

  // Unmerged gate-exit branches against origin/<base> (or the landing's fallbacks).
  const refs = await resolveGateExitRefs(git, hasOrigin);
  const unmerged = await listGateExitBranches(git, refs, { unmergedOnly: true });
  if (unmerged.ok && unmerged.branches.length > 0) {
    return {
      ok: false,
      exitCode: COUNTDOWN_EXIT.pending,
      reason: `unmerged gate-exit branch(es) with no marker entry: ${unmerged.branches.join(", ")}; merge or discard them first`,
    };
  }
  return { ok: true, pendingBefore: pending.length, base: refs.base };
}

export interface ExecuteCountdownInput {
  cwd: string;
  job: string;
  slash?: string;
  backend: string;
  model?: string;
  maxTicks: string | number;
  /** Review job only: `--max-pack-bytes` (default 98304). */
  maxPackBytes?: string | number;
  /** Review job only: `--include-reviewed`. */
  includeReviewed?: boolean;
  windowMin: string | number;
  stallMin: string | number;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  exec?: ExecFn;
  spawnJob?: SpawnJob;
  whichFn?: WhichFn;
  land?: (opts: LandGateExitOptions) => Promise<LandGateExitResult>;
  killGraceMs?: number;
  /** Terminal sink (default: process.stdout). */
  write?: (text: string) => void;
  /** Forward SIGINT/SIGTERM sent to this process to the child group (CLI only). */
  forwardSignals?: boolean;
}

export interface ExecuteCountdownResult {
  exitCode: number;
  error?: string;
  logPath?: string;
}

function positive(raw: string | number, flag: string, integer: boolean): number | string {
  const value = integer ? Number.parseInt(String(raw), 10) : Number.parseFloat(String(raw));
  if (!Number.isFinite(value) || value <= 0 || (integer && String(value) !== String(raw).trim())) {
    return `${flag} must be a positive ${integer ? "integer" : "number"}`;
  }
  return value;
}

export async function executeCountdown(
  input: ExecuteCountdownInput,
): Promise<ExecuteCountdownResult> {
  const root = path.resolve(input.cwd);
  const env = input.env ?? process.env;
  const exec = input.exec ?? defaultExec;
  const now = input.now ?? new Date();
  const write = input.write ?? ((text: string) => process.stdout.write(text));
  const usage = (error: string): ExecuteCountdownResult => ({
    exitCode: COUNTDOWN_EXIT.usage,
    error,
  });

  // Promotion is refused before anything else, exactly as `agent-kit run` refuses it.
  const slash = normalizeSlashName(input.slash ?? "");
  const job = String(input.job).trim();
  for (const name of [slash, job]) {
    if (name && classifySlash(name) === "promote-blocked")
      return usage(promoteBlockedMessage(name));
  }
  if (!(COUNTDOWN_JOBS as readonly string[]).includes(job)) {
    return usage(`--job must be one of: ${COUNTDOWN_JOBS.join(", ")}`);
  }
  if (job === "dispatch") {
    if (!slash) return usage("--job dispatch needs --slash <name> (e.g. --slash backlog-add)");
    if (classifySlash(slash) === "unknown") return usage(unknownSlashMessage(slash));
  } else if (slash) {
    return usage("--slash only applies to --job dispatch");
  }
  const maxTicks = positive(input.maxTicks, "--max-ticks", true);
  const windowMin = positive(input.windowMin, "--window-min", false);
  const stallMin = positive(input.stallMin, "--stall-min", false);
  for (const v of [maxTicks, windowMin, stallMin]) if (typeof v === "string") return usage(v);

  const packRaw = input.maxPackBytes === undefined ? "" : String(input.maxPackBytes).trim();
  if (job !== "review" && packRaw) return usage("--max-pack-bytes only applies to --job review");
  if (job !== "review" && input.includeReviewed) {
    return usage("--include-reviewed only applies to --job review");
  }

  const detected = await detectAgentBackend(input.backend, input.whichFn);
  if (!detected.ok) return usage(detected.message);
  let maxPackBytes: number | undefined;
  if (job === "review") {
    if (!(REVIEW_BACKENDS as readonly string[]).includes(detected.id)) {
      return usage(reviewBackendMessage(detected.id));
    }
    const parsed = parseReviewPackMaxBytes(packRaw, detected.id);
    if (typeof parsed === "string") return usage(parsed);
    maxPackBytes = parsed;
  }

  // Lines are buffered until preflight is done, so the log file never makes
  // the tree look dirty on a repository whose ignore rules miss it. The
  // loop-logs dir (with its self-ignoring `.gitignore`) is made before the
  // preflight instead: that also hides logs an earlier fire left untracked.
  const statePaths = runnerStatePaths(root, env);
  await ensureLoopLogsDir(statePaths).catch(() => undefined);
  const redactions = gateExitRedactions(env);
  const red = (text: string) => redactSecrets(text, redactions);
  const buffered: string[] = [];
  let logPath: string | null = null;
  // One chain keeps log writes in order.
  let logChain: Promise<void> = Promise.resolve();
  const toLog = (text: string) => {
    if (!logPath) {
      buffered.push(text);
      return;
    }
    const file = logPath;
    logChain = logChain.then(() => appendFile(file, text, "utf8").catch(() => undefined));
  };
  const say = (line: string) => {
    const text = `${red(`countdown: ${line}`)}\n`;
    write(text);
    toLog(text);
  };
  const openLog = async () => {
    await ensureLoopLogsDir(statePaths);
    const file = path.join(statePaths.loopLogsDir, `countdown-${gateExitStamp(now)}.log`);
    await appendFile(file, buffered.join(""), "utf8");
    buffered.length = 0;
    logPath = file;
  };

  const jobLabel =
    job === "tick" ? "run-plan" : job === "review" ? `run ${REVIEW_PACK_SLASH}` : `run ${slash}`;
  say(`fire ${gateExitStamp(now)}: job ${job} (${jobLabel}) on ${detected.id}`);
  const preflight = await countdownPreflight({ root, env, exec, now, log: say });
  if (!preflight.ok) {
    say(`refused: ${preflight.reason} (exit ${preflight.exitCode})`);
    await openLog().catch(() => undefined);
    return { exitCode: preflight.exitCode, ...(logPath ? { logPath } : {}) };
  }
  await openLog();
  const capLines = [CLAUDE_MAX_TURNS_ENV, CLAUDE_MAX_BUDGET_USD_ENV]
    .filter((k) => env[k])
    .map((k) => `${k}=${env[k]}`);
  const sizeCap =
    job === "review"
      ? `pack ceiling ${maxPackBytes} bytes${input.includeReviewed ? ", including branches already reviewed" : ""}`
      : `max ticks ${maxTicks}`;
  say(
    `caps: window ${windowMin} min, stall ${stallMin} min, ${sizeCap}${capLines.length ? `, ${capLines.join(", ")}` : ""}`,
  );

  const args = countdownChildArgs({
    job: job as CountdownJob,
    slash,
    backend: detected.id,
    maxTicks: maxTicks as number,
    ...(input.model ? { model: input.model } : {}),
    ...(maxPackBytes !== undefined ? { maxPackBytes } : {}),
    ...(job === "review" && input.includeReviewed ? { includeReviewed: true } : {}),
  });
  say(`starting: agent-kit ${args.join(" ")}`);
  const handle = (input.spawnJob ?? defaultSpawnJob)(args, { cwd: root, env });
  const forward = (signal: NodeJS.Signals) => handle.kill(signal);
  const onSigint = () => forward("SIGINT");
  const onSigterm = () => forward("SIGTERM");
  if (input.forwardSignals) {
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  }
  // Line-buffered redaction: a secret split across two output chunks is
  // still elided whole (per-chunk redaction would miss it).
  const jobOut = new RedactingStreamBuffer(redactions);
  const emitJob = (out: string) => {
    if (!out) return;
    write(out);
    toLog(out);
  };
  let end: SuperviseResult;
  try {
    end = await superviseJob(handle, {
      windowMs: (windowMin as number) * 60_000,
      stallMs: (stallMin as number) * 60_000,
      killGraceMs: input.killGraceMs ?? COUNTDOWN_KILL_GRACE_MS,
      onData: (text) => emitJob(jobOut.push(text)),
      onCircuitsDead: (cause) =>
        say(
          cause === "window"
            ? `Circuit's Dead: the ${windowMin} min window is over; stopping the job (SIGTERM, then SIGKILL)`
            : `Circuit's Dead: no stream event for ${stallMin} min; stopping the job (SIGTERM, then SIGKILL)`,
        ),
    });
  } finally {
    if (input.forwardSignals) {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    }
    emitJob(jobOut.flush());
  }

  const after = await readGateExitMarker(root);
  const pendingAfter = after.kind === "ok" ? after.marker.pending.length : preflight.pendingBefore;
  const pendingGrew = pendingAfter > preflight.pendingBefore;
  const exitCode = countdownExitCode({
    code: end.code,
    circuitsDead: end.circuitsDead,
    pendingGrew,
  });

  // The child lands its own gate stops and failures (`--land-on-gate`); a
  // killed or crashed child that left no entry is landed here, so Circuit's
  // Dead is never swallowed.
  if (exitCode === COUNTDOWN_EXIT.circuitsDead && !pendingGrew) {
    const reason = end.circuitsDead
      ? `Circuit's Dead: ${end.circuitsDead === "window" ? `window of ${windowMin} min exceeded` : `no stream event for ${stallMin} min`}`
      : `Circuit's Dead: job exited with ${end.code === null ? `signal ${end.signal ?? "unknown"}` : `code ${end.code}`}`;
    const outcome: GateExitOutcome = {
      trigger: "failure",
      exitCode,
      reason,
      command: `countdown --job ${job}${job === "dispatch" ? ` --slash ${slash}` : ""}`,
      backend: detected.id,
      ...(logPath ? { logPath } : {}),
    };
    try {
      await (input.land ?? landGateExit)({ root, outcome, env, log: (line) => say(line) });
    } catch (err) {
      say(`gate-exit: landing failed: ${String(err)}`);
    }
  }
  const meaning =
    exitCode === 0
      ? "completed"
      : exitCode === COUNTDOWN_EXIT.pending
        ? job === "review" && end.code === 0
          ? "review findings landed; gate exit pending"
          : "gate reached; gate exit pending"
        : "Circuit's Dead";
  say(`exit ${exitCode} (${meaning})`);
  await logChain;
  return { exitCode, ...(logPath ? { logPath } : {}) };
}

export const countdownCommand = defineCommand({
  meta: {
    name: "countdown",
    description:
      "Countdown: one-shot launcher for a cron/systemd timer. Runs one headless job (tick, dispatch or review) with --no-hitl --land-on-gate; refused while a gate exit is pending. Exit 0 done, 2 gate or findings pending, 3 Circuit's Dead. Never git-prod.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Project root (default: current directory)",
      default: process.cwd(),
    },
    job: {
      type: "string",
      description:
        "tick (one run-plan tick, default) | dispatch (agent-kit run --slash <name>) | review (review-only pass over a bounded diff pack of unmerged branches; findings land as a gate exit)",
      default: "tick",
    },
    slash: {
      type: "string",
      description: "For --job dispatch: the L0 slash to run (git-prod and kit-prod are refused)",
      default: "",
    },
    backend: {
      type: "string",
      description: `Agent backend (${listDetectBackendIds().join(" | ")}; default: auto)`,
      default: "auto",
    },
    model: {
      type: "string",
      description: "Optional model id passed to the agent backend",
      default: "",
    },
    "max-ticks": {
      type: "string",
      description: `Maximum ticks for this fire (default: ${COUNTDOWN_DEFAULT_MAX_TICKS})`,
      default: String(COUNTDOWN_DEFAULT_MAX_TICKS),
    },
    "max-pack-bytes": {
      type: "string",
      description: `For --job review: diff pack ceiling in bytes (default: ${REVIEW_PACK_DEFAULT_MAX_BYTES}; a branch whose section does not fit is listed as not reviewed, never cut)`,
      default: "",
    },
    "include-reviewed": {
      type: "boolean",
      description:
        "For --job review: also review branches whose tip is unchanged since the last completed review",
      default: false,
    },
    "window-min": {
      type: "string",
      description: `Wall-clock cap in minutes; past it the job is stopped as Circuit's Dead (default: ${COUNTDOWN_DEFAULT_WINDOW_MIN})`,
      default: String(COUNTDOWN_DEFAULT_WINDOW_MIN),
    },
    "stall-min": {
      type: "string",
      description: `Minutes with no stream event before the job is stopped as Circuit's Dead (default: ${COUNTDOWN_DEFAULT_STALL_MIN})`,
      default: String(COUNTDOWN_DEFAULT_STALL_MIN),
    },
  },
  async run({ args }) {
    const result = await executeCountdown({
      cwd: String(args.cwd),
      job: String(args.job),
      slash: String(args.slash ?? ""),
      backend: String(args.backend),
      ...(args.model ? { model: String(args.model) } : {}),
      maxTicks: String(args["max-ticks"]),
      ...(args["max-pack-bytes"] ? { maxPackBytes: String(args["max-pack-bytes"]) } : {}),
      ...(args["include-reviewed"] ? { includeReviewed: true } : {}),
      windowMin: String(args["window-min"]),
      stallMin: String(args["stall-min"]),
      forwardSignals: true,
    });
    if (result.error) logger.error(result.error);
    process.exitCode = result.exitCode;
  },
});
