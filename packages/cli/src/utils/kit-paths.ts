import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Shared relative paths for kit session / project files used across slim CLI.
 * POSIX literals so protected globs, joins, and messages stay stable across OS.
 */

/** Active handoff file (inventory SoT with plan-index). */
export const HANDOFF_REL = ".cursor/HANDOFF.md";

/**
 * Runner state root (ADR 2026-10-08 mission-control-embeddable-contract,
 * Amend 2): where the headless runner keeps the files it owns, `loop-logs/`
 * and `loop.stop`.
 * `.cursor` stays the default; `AGENT_KIT_STATE_ROOT=.agent-kit` moves them
 * for hosts that do not want runner output under `.cursor/`. Only these two
 * values are accepted (no arbitrary paths). The agent contract files (plans,
 * HANDOFF, commands, memory, context) stay under `.cursor/` either way: the
 * prompts and slash adapters name that path literally, and moving them is the
 * separate worktree-safe-state work.
 */
export const STATE_ROOT_ENV = "AGENT_KIT_STATE_ROOT";
export const STATE_ROOT_DIRS = [".cursor", ".agent-kit"] as const;
export type StateRootDir = (typeof STATE_ROOT_DIRS)[number];

export interface RunnerStatePaths {
  stateDir: StateRootDir;
  loopLogsDir: string;
  stopFile: string;
  /** Set when the env asked for an unsupported value (the default was used). */
  invalid?: string;
}

/** Validated runner state dir from the environment (default `.cursor`). */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): {
  stateDir: StateRootDir;
  invalid?: string;
} {
  const raw = (env[STATE_ROOT_ENV] ?? "").trim().replace(/\/+$/, "");
  if (!raw) return { stateDir: ".cursor" };
  if ((STATE_ROOT_DIRS as readonly string[]).includes(raw))
    return { stateDir: raw as StateRootDir };
  return { stateDir: ".cursor", invalid: raw };
}

/** Absolute runner paths under `root` for the resolved state dir. */
export function runnerStatePaths(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): RunnerStatePaths {
  const { stateDir, invalid } = resolveStateDir(env);
  const base = path.join(root, stateDir);
  return {
    stateDir,
    loopLogsDir: path.join(base, "loop-logs"),
    stopFile: path.join(base, "loop.stop"),
    ...(invalid !== undefined ? { invalid } : {}),
  };
}

/**
 * Make the loop-logs dir and, outside `.cursor` (whose repo `.gitignore`
 * covers it), drop a `.gitignore` of `*` inside it so redacted agent output
 * is never swept into a commit by `/git-staging`.
 */
export async function ensureLoopLogsDir(paths: RunnerStatePaths): Promise<void> {
  await mkdir(paths.loopLogsDir, { recursive: true });
  if (paths.stateDir === ".cursor") return;
  const ignore = path.join(paths.loopLogsDir, ".gitignore");
  try {
    await writeFile(ignore, "*\n", { flag: "wx" });
  } catch {
    // Already there (or unwritable: the logs still work).
  }
}
