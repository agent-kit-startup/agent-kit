/**
 * Environment diagnostics for `doctor`'s environment pillar.
 *
 * Read-only: never writes files, never edits PATH/shell profiles, never
 * installs anything, and never throws — every check swallows its own
 * failures into a safe default so a broken environment still produces a
 * usable report instead of crashing `doctor`.
 *
 * npm's global prefix is inferred from env/`.npmrc`/the running Node
 * binary's location instead of spawning `npm config get prefix` — npm CLI
 * startup is slow (multi-second) in some environments (containers, cold
 * caches), and this is a diagnostic that must stay fast and dependency-free.
 */

import { constants, access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Minimum supported Node.js major version. */
export const MIN_NODE_MAJOR = 20;

export interface NpmPrefixReport {
  /** The active npm global prefix, or null if it could not be determined. */
  prefix: string | null;
  /** Whether the current user can write into the prefix directory. */
  writable: boolean;
  /** How `prefix` was determined: explicit env, .npmrc, or a heuristic. */
  source?: "env" | "npmrc" | "heuristic";
  /** Human-readable explanation when `writable` is false or unknown. */
  reason?: string;
}

export interface EnvironmentReport {
  /** True when a bare `agent-kit` resolves on PATH. */
  binOnPath: boolean;
  /** True when the active npm global prefix is writable by the current user. */
  npmPrefixWritable: boolean;
  /** Detail behind `npmPrefixWritable` (prefix path, reason when not writable). */
  npmPrefix: NpmPrefixReport;
  /** True when the running Node.js major version is >= MIN_NODE_MAJOR. */
  nodeVersionOk: boolean;
  /** Raw Node.js version string used for the check (e.g. "v20.11.0"). */
  nodeVersion: string;
  /** Detected shell binary name (e.g. "zsh", "bash"), or null if unknown. */
  shell: string | null;
  /**
   * Detected shell profile path candidate for zsh/bash, or null when the
   * shell isn't zsh/bash (or couldn't be detected). Diagnostic only — this
   * to-do never writes to it.
   */
  shellProfile: string | null;
}

export interface AssessEnvironmentOptions {
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Defaults to process.version. */
  nodeVersion?: string;
  /** Defaults to homedir(). */
  homeDir?: string;
  /** Defaults to process.execPath. Used for the npm-prefix heuristic fallback. */
  execPath?: string;
  /** Defaults to "agent-kit". */
  binName?: string;
  /** Injectable for tests; defaults to fs/promises readFile. */
  readFileImpl?: (filePath: string) => Promise<string>;
}

/** True when a bare `binName` resolves to an executable on PATH. */
export async function checkBinOnPath(
  binName: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<boolean> {
  const pathVar = env.PATH ?? env.Path ?? "";
  if (!pathVar) return false;
  const dirs = pathVar.split(path.delimiter).filter(Boolean);
  const candidates =
    platform === "win32"
      ? [binName, `${binName}.cmd`, `${binName}.exe`, `${binName}.bat`]
      : [binName];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      try {
        // Windows access() X_OK is unreliable; existence (F_OK, the default
        // mode) is the practical signal there. POSIX checks executability.
        await access(path.join(dir, candidate), platform === "win32" ? undefined : constants.X_OK);
        return true;
      } catch {
        // Not found here; keep scanning remaining PATH entries.
      }
    }
  }
  return false;
}

/** True when the Node major version parsed from `nodeVersion` is >= minMajor. */
export function isNodeVersionOk(nodeVersion: string, minMajor: number = MIN_NODE_MAJOR): boolean {
  const match = /^v?(\d+)/.exec(nodeVersion);
  if (!match) return false;
  const major = Number(match[1]);
  return Number.isFinite(major) && major >= minMajor;
}

/** Detected shell binary name from $SHELL, or null if unset/unrecognized. */
export function detectShellName(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  if (platform === "win32") {
    // Best-effort diagnostic only; profile detection below is zsh/bash-only.
    if (env.PSModulePath) return "powershell";
    if (env.ComSpec) return "cmd";
    return null;
  }
  const shellPath = env.SHELL;
  if (!shellPath) return null;
  const base = path.basename(shellPath).trim();
  return base || null;
}

/** Shell profile path candidate for zsh/bash; null for any other shell. */
export function detectShellProfile(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homeDir: string,
): string | null {
  const shellName = detectShellName(env, platform);
  if (shellName === "zsh") return path.join(homeDir, ".zshrc");
  if (shellName === "bash") return path.join(homeDir, ".bashrc");
  return null;
}

/** Extract a `prefix = ...` value from .npmrc-style config text, if present. */
export function parseNpmrcPrefix(content: string, homeDir: string): string | null {
  const match = /^\s*prefix\s*=\s*(.+?)\s*$/m.exec(content);
  const captured = match?.[1];
  if (!captured) return null;
  let value = captured.trim().replace(/^["']|["']$/g, "");
  if (value.startsWith("~")) {
    value = path.join(homeDir, value.slice(1));
  }
  return value || null;
}

/** Heuristic prefix inferred from the running Node binary's location. */
export function heuristicPrefixFromExecPath(execPath: string, platform: NodeJS.Platform): string {
  // Global bins conventionally live under `${prefix}/bin` on POSIX (node
  // itself sits at `${prefix}/bin/node`) and directly under `${prefix}` on
  // Windows (`${prefix}/node.exe`). Use the explicit win32/posix path
  // variants (not the host-dependent default) so this stays correct when
  // assessed on one platform for a path shaped like another (as in tests).
  const p = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32" ? p.dirname(execPath) : p.dirname(p.dirname(execPath));
}

export interface DetectedNpmPrefix {
  prefix: string;
  source: "env" | "npmrc" | "heuristic";
}

/**
 * Determine the active npm global prefix without spawning npm: explicit env
 * override first, then a `prefix` line in the user .npmrc, then a heuristic
 * derived from the running Node binary's location.
 */
export async function detectNpmPrefix(
  options: AssessEnvironmentOptions = {},
): Promise<DetectedNpmPrefix> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const execPath = options.execPath ?? process.execPath;
  const readFileImpl = options.readFileImpl ?? ((filePath: string) => readFile(filePath, "utf8"));

  const envPrefix = env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX;
  if (envPrefix?.trim()) {
    return { prefix: envPrefix.trim(), source: "env" };
  }

  const userconfigPath = env.NPM_CONFIG_USERCONFIG ?? path.join(homeDir, ".npmrc");
  try {
    const content = await readFileImpl(userconfigPath);
    const npmrcPrefix = parseNpmrcPrefix(content, homeDir);
    if (npmrcPrefix) {
      return { prefix: npmrcPrefix, source: "npmrc" };
    }
  } catch {
    // No .npmrc (or unreadable) — fall through to the heuristic.
  }

  return { prefix: heuristicPrefixFromExecPath(execPath, platform), source: "heuristic" };
}

async function describeUnwritablePrefix(prefix: string): Promise<string> {
  try {
    const info = await stat(prefix);
    const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (
      process.platform !== "win32" &&
      currentUid !== undefined &&
      info.uid === 0 &&
      currentUid !== 0
    ) {
      return `root-owned prefix (${prefix}); the classic fresh-install PATH/EACCES blocker`;
    }
  } catch {
    // Fall through to the generic reason below.
  }
  return `npm prefix is not writable: ${prefix}`;
}

/** Resolve the active npm global prefix and whether it's user-writable. */
export async function checkNpmPrefixWritable(
  options: AssessEnvironmentOptions = {},
): Promise<NpmPrefixReport> {
  let detected: DetectedNpmPrefix;
  try {
    detected = await detectNpmPrefix(options);
  } catch {
    return { prefix: null, writable: false, reason: "npm prefix could not be determined" };
  }

  try {
    await access(detected.prefix, constants.W_OK);
    return { prefix: detected.prefix, writable: true, source: detected.source };
  } catch {
    return {
      prefix: detected.prefix,
      writable: false,
      source: detected.source,
      reason: await describeUnwritablePrefix(detected.prefix),
    };
  }
}

/**
 * Assess the local environment for the `doctor` environment pillar.
 * Pure diagnostic: no writes, no prompts, no process.exit, never throws.
 */
export async function assessEnvironment(
  options: AssessEnvironmentOptions = {},
): Promise<EnvironmentReport> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.version;
  const homeDir = options.homeDir ?? homedir();
  const binName = options.binName ?? "agent-kit";

  const [binOnPath, npmPrefix] = await Promise.all([
    checkBinOnPath(binName, env, platform).catch(() => false),
    checkNpmPrefixWritable(options).catch(
      (): NpmPrefixReport => ({
        prefix: null,
        writable: false,
        reason: "npm prefix check failed unexpectedly",
      }),
    ),
  ]);

  return {
    binOnPath,
    npmPrefixWritable: npmPrefix.writable,
    npmPrefix,
    nodeVersionOk: isNodeVersionOk(nodeVersion),
    nodeVersion,
    shell: detectShellName(env, platform),
    shellProfile: detectShellProfile(env, platform, homeDir),
  };
}
