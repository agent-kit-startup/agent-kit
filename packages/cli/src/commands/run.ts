import { homedir } from "node:os";
import path from "node:path";
import { defineCommand } from "citty";
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
  runHeadlessDispatch,
  unknownSlashMessage,
} from "../plan-loop/dispatch.js";
import { runPlanLoop } from "../plan-loop/run-loop.js";
import { logger } from "../utils/logger.js";

export interface ExecuteRunInput {
  slash: string;
  cwd: string;
  backend: string;
  model?: string;
  dryRun: boolean;
  maxTicks: number;
  sleepSeconds: number;
  whichFn?: WhichFn;
}

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
    });
    return { exitCode: code };
  }

  const file = await readCommandFile(root, slash);
  if (!file.ok) {
    return { exitCode: 1, error: file.message };
  }
  const prompt = buildDispatchPrompt(file.body);

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
    const result = await runHeadlessDispatch({
      backendId: detected.id,
      bin: detected.bin,
      workspace: root,
      prompt,
      model: input.model,
      logPath,
    });
    return { exitCode: result.exitCode };
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

  const result = await executeRun({
    slash,
    cwd: String(args.cwd),
    backend: String(args.backend),
    model: args.model ? String(args.model) : undefined,
    dryRun: Boolean(args["dry-run"]),
    maxTicks,
    sleepSeconds,
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
      "Start one headless session from an L0 slash file. Numbered-list HITL. Never git-prod.",
  },
  args: {
    slash: {
      type: "positional",
      description: "Slash name (e.g. run-plan-all, backlog-add, continue-plan)",
      required: true,
    },
    ...runDispatchArgs,
  },
  async run({ args }) {
    await runSlashCli(String(args.slash ?? ""), args);
  },
});

export const runPlanAllCommand = defineCommand({
  meta: {
    name: "run-plan-all",
    description:
      "Headless /run-plan-all queue from the L0 file. Numbered-list HITL. Never git-prod.",
  },
  args: runDispatchArgs,
  async run({ args }) {
    await runSlashCli("run-plan-all", args);
  },
});
