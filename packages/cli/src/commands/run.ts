import { homedir } from "node:os";
import path from "node:path";
import { defineCommand } from "citty";
import { shouldUseLiveTui, withLiveTui } from "../mission-control/live-run.js";
import type { AgentBackend } from "../plan-loop/backends.js";
import { getBackend } from "../plan-loop/backends.js";
import type { WhichFn } from "../plan-loop/detect.js";
import { detectAgentBackend, listDetectBackendIds } from "../plan-loop/detect.js";
import {
  buildDispatchPrompt,
  classifySlash,
  ensureDispatchLogPath,
  normalizeSlashName,
  promoteBlockedMessage,
  readCommandFile,
  resolveOperatorNote,
  runHeadlessDispatch,
  unknownSlashMessage,
} from "../plan-loop/dispatch.js";
import { landDispatchOutcome, runDispatchDriver } from "../plan-loop/dispatch-driver.js";
import { DRIVER_EVENTS_FORMATS } from "../plan-loop/driver-events.js";
import { LAND_ON_GATE_DESCRIPTION } from "../plan-loop/gate-exit.js";
import {
  formatHitlSummary,
  HITL_UNANSWERED_EXIT_CODE,
  hitlExitCode,
} from "../plan-loop/hitl-relay.js";
import { REVIEW_PACK_SLASH, runReviewJob } from "../plan-loop/review-job.js";
import { type DriverRunOptions, runPlanLoop } from "../plan-loop/run-loop.js";
import { logger } from "../utils/logger.js";
import { negatedFlag } from "./negated-flag.js";

export interface ExecuteRunInput {
  slash: string;
  cwd: string;
  backend: string;
  model?: string;
  dryRun: boolean;
  maxTicks: number;
  sleepSeconds: number;
  /** `--no-hitl`: a gate stops the run (exit 4) instead of prompting. */
  noHitl?: boolean;
  /** `--plain`: status lines instead of the Mission Control live view on a TTY. */
  plain?: boolean;
  /** `--land-on-gate`: land a gate stop or failure on a `gate-exit/<stamp>` branch. */
  landOnGate?: boolean;
  /** `--max-pack-bytes` (review-pack only): the diff pack ceiling. */
  maxPackBytes?: string;
  /** `--include-reviewed` (review-pack only): review branches unchanged since the last review too. */
  includeReviewed?: boolean;
  /**
   * `--events ndjson` (run-plan-all only): driver mode, NDJSON events on
   * stdout and JSON answers on stdin (plan-loop/dispatch-driver.ts).
   */
  events?: DriverRunOptions;
  /**
   * `--note` (run-plan-all only): operator resolution text, already resolved
   * from `@file`, appended after the L0 body. Never a gate answer.
   */
  note?: string;
  whichFn?: WhichFn;
}

/** The only slash whose dispatch has a driver mode (driver protocol 1.3.0). */
export const DRIVER_DISPATCH_SLASH = "run-plan-all";

export interface ExecuteRunResult {
  exitCode: number;
  error?: string;
  stdout?: string;
}

/**
 * Collapse the home directory prefix to `~` for console output: tips must not
 * print absolute home paths (visual-kit ADR point 4); the agent binary usually
 * lives under `~/.local/bin`, `~/.claude/local` or an nvm prefix.
 */
export function displayPath(target: string, home: string = homedir()): string {
  const resolvedHome = path.resolve(home);
  if (target === resolvedHome) return "~";
  const prefix = resolvedHome.endsWith(path.sep) ? resolvedHome : `${resolvedHome}${path.sep}`;
  return target.startsWith(prefix) ? `~${path.sep}${target.slice(prefix.length)}` : target;
}

/**
 * Core for `agent-kit run`. Testable without spawning when dryRun is true
 * or when detect/classify fail before spawn.
 */
export async function executeRun(input: ExecuteRunInput): Promise<ExecuteRunResult> {
  const root = path.resolve(input.cwd);
  const slash = normalizeSlashName(input.slash);
  if (!slash) {
    return { exitCode: 1, error: "Provide a slash: agent-kit run <slash>" };
  }

  const kind = classifySlash(slash);
  if (kind === "promote-blocked") {
    return { exitCode: 1, error: promoteBlockedMessage(slash) };
  }
  if (kind === "unknown") {
    return { exitCode: 1, error: unknownSlashMessage(slash) };
  }
  if (input.maxPackBytes?.trim() && slash !== REVIEW_PACK_SLASH) {
    return { exitCode: 1, error: `--max-pack-bytes only applies to ${REVIEW_PACK_SLASH}` };
  }
  if (input.includeReviewed && slash !== REVIEW_PACK_SLASH) {
    return { exitCode: 1, error: `--include-reviewed only applies to ${REVIEW_PACK_SLASH}` };
  }
  if (input.note !== undefined && slash !== DRIVER_DISPATCH_SLASH) {
    return { exitCode: 1, error: `--note only applies to ${DRIVER_DISPATCH_SLASH}` };
  }
  if (input.events) {
    if (slash !== DRIVER_DISPATCH_SLASH) {
      return {
        exitCode: 1,
        error: `--events only applies to ${DRIVER_DISPATCH_SLASH} (and agent-kit run-plan)`,
      };
    }
    // Driver mode owns stdout from here: every outcome, setup errors
    // included, is an event (no `error` / `stdout` text for the caller).
    const exitCode = await runDispatchDriver({
      root,
      slash: DRIVER_DISPATCH_SLASH,
      backend: input.backend,
      model: input.model,
      dryRun: input.dryRun,
      noHitl: input.noHitl === true,
      landOnGate: input.landOnGate === true,
      events: input.events,
      ...(input.note !== undefined ? { note: input.note } : {}),
      whichFn: input.whichFn,
    });
    return { exitCode };
  }

  const detected = await detectAgentBackend(input.backend, input.whichFn);
  if (!detected.ok) {
    return { exitCode: 1, error: detected.message };
  }

  if (kind === "run-plan") {
    // Aliases the tick loop on whichever backend detect resolved; `claude`
    // runs ticks as headless `claude -p` (backends.ts claudeBackend).
    let backend: AgentBackend;
    try {
      backend = getBackend(detected.id);
    } catch (err) {
      return { exitCode: 1, error: String(err) };
    }
    if (input.dryRun) {
      const preview = [
        `--dry-run: alias agent-kit run-plan (backend ${detected.id} at ${displayPath(detected.bin)})`,
        "No agent will be started. Tick prompt is the existing run-plan loop prompt.",
      ].join("\n");
      return { exitCode: 0, stdout: preview };
    }
    const code = await runPlanLoop({
      root,
      maxTicks: input.maxTicks,
      sleepSeconds: input.sleepSeconds,
      model: input.model,
      dryRun: false,
      backend,
      noHitl: input.noHitl === true,
      plain: input.plain === true,
      landOnGate: input.landOnGate === true,
    });
    return { exitCode: code };
  }

  if (slash === REVIEW_PACK_SLASH) {
    // The review job: a bounded diff pack, one review-only session, findings
    // landed through the gate exit (always on for this slash).
    try {
      return await runReviewJob({
        root,
        backendId: detected.id,
        bin: detected.bin,
        model: input.model,
        maxPackBytes: input.maxPackBytes,
        includeReviewed: input.includeReviewed === true,
        noHitl: input.noHitl === true,
        dryRun: input.dryRun,
      });
    } catch (err) {
      return { exitCode: 1, error: String(err) };
    }
  }

  const file = await readCommandFile(root, slash);
  if (!file.ok) {
    return { exitCode: 1, error: file.message };
  }
  const prompt = buildDispatchPrompt(file.body, input.note);

  if (input.dryRun) {
    const stdout = [
      "--dry-run: no agent will be started.",
      `Slash: ${slash}`,
      `Command file: ${path.relative(root, file.path)}`,
      `Backend: ${detected.id} (${displayPath(detected.bin)})`,
      "Prompt:",
      prompt,
    ].join("\n");
    return { exitCode: 0, stdout };
  }

  const logPath = await ensureDispatchLogPath(root);
  console.log(`Dispatch: ${slash} via ${detected.id}`);
  console.log(`Command file: ${path.relative(root, file.path)}`);
  console.log(`Log: ${path.relative(root, logPath)}`);

  try {
    const dispatch = {
      backendId: detected.id,
      bin: detected.bin,
      workspace: root,
      prompt,
      model: input.model,
      logPath,
    };
    const result = shouldUseLiveTui({ plain: input.plain })
      ? await withLiveTui(
          { root, backend: detected.id, logPath, noHitl: input.noHitl === true },
          (seams) =>
            runHeadlessDispatch({
              ...dispatch,
              hitl: seams.hitl,
              render: seams.render,
              onSpawn: seams.onSpawn,
              log: seams.log,
            }),
        )
      : await runHeadlessDispatch({
          ...dispatch,
          hitl: { policy: input.noHitl ? "off" : "prompt" },
        });
    for (const line of formatHitlSummary(result.hitl)) console.log(line);
    const exitCode = hitlExitCode(result.exitCode, result.hitl);
    if (input.landOnGate) {
      await landDispatchOutcome({
        root,
        slash,
        backendId: detected.id,
        logPath,
        exitCode,
        result,
        log: (line) => console.log(line),
      });
    }
    return { exitCode };
  } catch (err) {
    return { exitCode: 1, error: String(err) };
  }
}

const runDispatchArgs = {
  cwd: {
    type: "string" as const,
    description: "Project root (default: current directory)",
    default: process.cwd(),
  },
  backend: {
    type: "string" as const,
    description: `Agent CLI (${listDetectBackendIds().join(" | ")}; default: auto)`,
    default: "auto",
  },
  model: {
    type: "string" as const,
    description: "Optional model id passed to the agent CLI",
    default: "",
  },
  "dry-run": {
    type: "boolean" as const,
    description: "Print the resolved backend and prompt, then exit without starting an agent",
    default: false,
  },
  "max-ticks": {
    type: "string" as const,
    description: "For run-plan alias only: maximum ticks (default: 10)",
    default: "10",
  },
  sleep: {
    type: "string" as const,
    description: "For run-plan alias only: seconds between ticks (default: 5)",
    default: "5",
  },
  "no-hitl": {
    type: "boolean" as const,
    description: `CI: never prompt; a HITL gate stops the run with exit ${HITL_UNANSWERED_EXIT_CODE} (no default answer)`,
    default: false,
  },
  plain: {
    type: "boolean" as const,
    description:
      "Status lines instead of the Mission Control live view (the default on a TTY; non-TTY, NO_COLOR and CI are always plain)",
    default: false,
  },
  "land-on-gate": {
    type: "boolean" as const,
    description: LAND_ON_GATE_DESCRIPTION,
    default: false,
  },
};

/** `agent-kit run` only (review-pack); `run-plan-all` never lists it. */
const maxPackBytesArg = {
  type: "string" as const,
  description:
    "For review-pack only: diff pack ceiling in bytes (default: 98304; a branch whose section does not fit is listed as not reviewed, never cut)",
  default: "",
};

/** `agent-kit run` only (review-pack); `run-plan-all` never lists it. */
const includeReviewedArg = {
  type: "boolean" as const,
  description:
    "For review-pack only: also review branches whose tip is unchanged since the last completed review (.cursor/context/review-ledger.json)",
  default: false,
};

export async function runSlashCli(
  slash: string,
  args: {
    cwd: string;
    backend: string;
    model?: string;
    "dry-run": boolean;
    "max-ticks": string;
    sleep: string;
    "no-hitl"?: boolean;
    /** citty sets this to false for `--no-hitl`; read through negatedFlag. */
    hitl?: boolean;
    plain?: boolean;
    "land-on-gate"?: boolean;
    "max-pack-bytes"?: string;
    "include-reviewed"?: boolean;
    /** run-plan-all only: `ndjson` turns driver mode on. */
    events?: string;
    /** run-plan-all only: operator resolution note, inline or `@file`. */
    note?: string;
  },
): Promise<void> {
  const maxTicks = Number.parseInt(String(args["max-ticks"]), 10);
  const sleepSeconds = Number.parseFloat(String(args.sleep));
  if (!Number.isFinite(maxTicks) || maxTicks < 1) {
    logger.error("--max-ticks must be a positive integer");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(sleepSeconds) || sleepSeconds < 0) {
    logger.error("--sleep must be a non-negative number");
    process.exitCode = 1;
    return;
  }
  const events = String(args.events ?? "");
  if (events && !(DRIVER_EVENTS_FORMATS as readonly string[]).includes(events)) {
    logger.error(`--events must be one of: ${DRIVER_EVENTS_FORMATS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  let note: string | undefined;
  if (args.note) {
    const resolved = await resolveOperatorNote(String(args.note), path.resolve(String(args.cwd)));
    if (!resolved.ok) {
      logger.error(resolved.message);
      process.exitCode = 1;
      return;
    }
    note = resolved.note;
  }

  const result = await executeRun({
    slash,
    cwd: String(args.cwd),
    backend: String(args.backend),
    model: args.model ? String(args.model) : undefined,
    dryRun: Boolean(args["dry-run"]),
    maxTicks,
    sleepSeconds,
    noHitl: negatedFlag(args, "hitl"),
    plain: Boolean(args.plain),
    landOnGate: Boolean(args["land-on-gate"]),
    ...(args["max-pack-bytes"] ? { maxPackBytes: String(args["max-pack-bytes"]) } : {}),
    ...(args["include-reviewed"] ? { includeReviewed: true } : {}),
    ...(events ? { events: {} } : {}),
    ...(note !== undefined ? { note } : {}),
  });
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.error) {
    logger.error(result.error);
  }
  process.exitCode = result.exitCode;
}

export const runCommand = defineCommand({
  meta: {
    name: "run",
    description:
      "Start one headless session from an L0 slash file. Numbered-list HITL answered from the terminal (claude backend). Never git-prod.",
  },
  args: {
    slash: {
      type: "positional",
      description: "Slash name (e.g. run-plan-all, backlog-add, continue-plan)",
      required: true,
    },
    ...runDispatchArgs,
    "max-pack-bytes": maxPackBytesArg,
    "include-reviewed": includeReviewedArg,
  },
  async run({ args }) {
    await runSlashCli(String(args.slash ?? ""), args);
  },
});

export const runPlanAllCommand = defineCommand({
  meta: {
    name: "run-plan-all",
    description:
      "Headless /run-plan-all queue from the L0 file. Numbered-list HITL answered from the terminal (claude backend). Never git-prod.",
  },
  args: {
    ...runDispatchArgs,
    events: {
      type: "string" as const,
      description:
        "Driver mode for apps: `ndjson` writes only NDJSON events to stdout and reads HITL answers as JSON lines on stdin (no TTY needed; driver protocol 1.3.0, see docs/driver-events-protocol.md)",
      default: "",
    },
    note: {
      type: "string" as const,
      description:
        "Operator resolution note appended to the session prompt: text or @file (e.g. the output of `agent-kit queue gates --prompt`). Context only, never a gate answer: a HITL_GATE:/HITL_REPLY: line is rejected",
      default: "",
    },
  },
  async run({ args }) {
    await runSlashCli("run-plan-all", args);
  },
});
