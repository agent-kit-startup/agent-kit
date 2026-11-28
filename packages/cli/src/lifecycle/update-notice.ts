/**
 * Machine update notice (ADR 2026-07-27 Amend 2026-11-26): check-only, on by
 * default, at most one npm lookup a day.
 *
 * - Compares this CLI with npm `latest` (both package names, c2) and every
 *   registered install (c3 `installs.json`) with this CLI.
 * - The npm answer is cached next to `installs.json` in the machine config dir
 *   (`update-notice.json`); the installs half is recomputed on every call, so
 *   the notice clears as soon as an update lands.
 * - The computed summary is written into the same file for Mission Control,
 *   which only reads it (no semver or kind logic in the dashboard).
 * - Off under `CI`, with `AGENT_KIT_NO_UPDATE_CHECK` / `NO_UPDATE_NOTIFIER`, and
 *   with `updateCheck.enabled: false`. Offline or any error is silent.
 * - Never applies anything: it names the operator command and stops.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  type InstallEntry,
  type InstallKind,
  listInstalls,
  resolveInstallsFile,
} from "../installs/index.js";
import { classifyNodeManagerPath, PER_VERSION_MANAGERS } from "../readiness/install-health.js";
import {
  CLI_NPM_PACKAGES,
  type CliNpmLatest,
  compareSemver,
  fetchLatestCliNpmVersion,
  type NpmFetch,
  normalizeSemver,
  updateCheckAllowed,
} from "./check-updates.js";
import { loadContextConfig } from "./context-config.js";
import { KIT_VERSION } from "./version.js";

export const UPDATE_NOTICE_FILENAME = "update-notice.json";
export const UPDATE_NOTICE_SCHEMA_VERSION = 1 as const;
/** One npm lookup a day at most. */
export const UPDATE_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;
/** sessionStart budget for the daily npm lookup; a miss is silent until tomorrow. */
export const UPDATE_NOTICE_SESSION_FETCH_TIMEOUT_MS = 1_500;

/**
 * Kinds the notice counts. `worktree`, `fixture` and `factory` rows are left
 * out: `agent-kit update --all` skips them too (a worktree follows its main
 * checkout, a fixture is not a consumer, the factory is the kit itself).
 */
export const UPDATE_NOTICE_KINDS: ReadonlySet<InstallKind> = new Set(["repo", "home"]);

export interface UpdateNoticeSummary {
  generatedAt: string;
  cliVersion: string;
  /** npm `latest` (highest across both names) or null when unknown. */
  npmLatest: CliNpmLatest | null;
  cliBehind: boolean;
  installsBehind: number;
  /** Oldest install behind this CLI; `path` is home-relative (`~/…`). */
  oldest: { path: string; kitVersion: string } | null;
  /** Operator command that upgrades the CLI, when `cliBehind`. */
  cliCommand: string | null;
  /** The sessionStart line, or null when everything is current. */
  line: string | null;
}

export interface UpdateNoticeCache {
  schemaVersion: typeof UPDATE_NOTICE_SCHEMA_VERSION;
  /** Last npm lookup attempt (success or not). */
  checkedAt: string;
  npm: CliNpmLatest | null;
  /** Last computed summary, for Mission Control; null when current. */
  notice?: UpdateNoticeSummary | null;
}

/** `update-notice.json` beside `installs.json` (same env / XDG / home resolution). */
export function resolveUpdateNoticeFile(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  return path.join(path.dirname(resolveInstallsFile(env, home)), UPDATE_NOTICE_FILENAME);
}

function isCliNpmLatest(value: unknown): value is CliNpmLatest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "string" &&
    normalizeSemver(v.version) !== null &&
    CLI_NPM_PACKAGES.some((pkg) => pkg.name === v.packageName)
  );
}

/** Read the cache; null when missing, unreadable or not ours. Never throws. */
export async function readUpdateNoticeCache(file: string): Promise<UpdateNoticeCache | null> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    if (!raw || raw.schemaVersion !== UPDATE_NOTICE_SCHEMA_VERSION) return null;
    if (typeof raw.checkedAt !== "string" || Number.isNaN(Date.parse(raw.checkedAt))) return null;
    return {
      schemaVersion: UPDATE_NOTICE_SCHEMA_VERSION,
      checkedAt: raw.checkedAt,
      npm: isCliNpmLatest(raw.npm)
        ? { packageName: raw.npm.packageName, version: raw.npm.version }
        : null,
      notice: (raw.notice as UpdateNoticeSummary | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

/** Temp file + rename; best-effort (a read-only config dir just means no cache). */
async function writeUpdateNoticeCache(file: string, cache: UpdateNoticeCache): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(tmp, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    await rename(tmp, file);
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

/** True when `checkedAt` is less than a day old (a future stamp counts as stale). */
export function updateNoticeCacheFresh(checkedAt: string, now: Date): boolean {
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age < UPDATE_NOTICE_TTL_MS;
}

export interface CachedNpmLatestOptions {
  file?: string;
  now?: Date;
  fetchImpl?: NpmFetch;
  timeoutMs?: number;
}

/**
 * npm `latest` of the CLI from the daily cache; a stale or missing cache costs
 * one lookup (bounded by `timeoutMs`), stamped even when it fails so an
 * offline machine does not pay the timeout on every session. Never throws.
 */
export async function cachedCliNpmLatest(
  options: CachedNpmLatestOptions = {},
): Promise<CliNpmLatest | null> {
  const file = options.file ?? resolveUpdateNoticeFile();
  const now = options.now ?? new Date();
  const cache = await readUpdateNoticeCache(file);
  if (cache && updateNoticeCacheFresh(cache.checkedAt, now)) return cache.npm;
  let npm: CliNpmLatest | null = null;
  try {
    npm = await fetchLatestCliNpmVersion(options.fetchImpl, options.timeoutMs);
  } catch {
    npm = null;
  }
  await writeUpdateNoticeCache(file, {
    schemaVersion: UPDATE_NOTICE_SCHEMA_VERSION,
    checkedAt: now.toISOString(),
    npm,
    notice: cache?.notice ?? null,
  });
  return npm;
}

function homeRelative(p: string, home: string): string {
  const rel = path.relative(home, p);
  if (rel === "") return "~";
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return `~/${rel.split(path.sep).join("/")}`;
  return p;
}

function semverLess(a: string, b: string): boolean {
  try {
    return compareSemver(a, b) < 0;
  } catch {
    return false;
  }
}

export interface SummarizeUpdateNoticeInput {
  cliVersion: string;
  npmLatest: CliNpmLatest | null;
  installs: readonly InstallEntry[];
  homeDir: string;
  now: Date;
  /** When the running CLI sits in a per-version node dir (mise, nvm, fnm). */
  cliInNodeManager?: boolean;
}

/** Pure: what is behind, and the one line to print (null when current). */
export function summarizeUpdateNotice(input: SummarizeUpdateNoticeInput): UpdateNoticeSummary {
  const cli = normalizeSemver(input.cliVersion) ?? input.cliVersion;
  const npm = input.npmLatest;
  const cliBehind = npm ? semverLess(cli, npm.version) : false;

  let installsBehind = 0;
  let oldest: InstallEntry | null = null;
  for (const entry of input.installs) {
    if (!UPDATE_NOTICE_KINDS.has(entry.kind) || !entry.kitVersion) continue;
    if (!semverLess(entry.kitVersion, cli)) continue;
    installsBehind += 1;
    if (
      !oldest ||
      semverLess(entry.kitVersion, oldest.kitVersion as string) ||
      (!semverLess(oldest.kitVersion as string, entry.kitVersion) &&
        entry.path.localeCompare(oldest.path) < 0)
    ) {
      oldest = entry;
    }
  }

  const cliCommand =
    cliBehind && npm
      ? input.cliInNodeManager
        ? "agent-kit doctor"
        : `npm i -g ${npm.packageName}@latest`
      : null;
  const oldestOut = oldest
    ? {
        path: homeRelative(oldest.path, input.homeDir),
        kitVersion: normalizeSemver(oldest.kitVersion as string) ?? (oldest.kitVersion as string),
      }
    : null;

  const parts: string[] = [];
  if (cliBehind && npm) {
    const hint = input.cliInNodeManager
      ? "`agent-kit doctor` shows the install that survives a node switch"
      : `\`${cliCommand}\``;
    parts.push(`CLI ${cli} < npm ${npm.version} (${hint})`);
  }
  if (installsBehind > 0 && oldestOut) {
    const noun = installsBehind === 1 ? "install" : "installs";
    const behind = cliBehind ? "behind" : `behind CLI ${cli}`;
    parts.push(
      `${installsBehind} ${noun} ${behind}, oldest v${oldestOut.kitVersion} at ${oldestOut.path} (\`agent-kit update --all\`)`,
    );
  }

  return {
    generatedAt: input.now.toISOString(),
    cliVersion: cli,
    npmLatest: npm,
    cliBehind,
    installsBehind,
    oldest: oldestOut,
    cliCommand,
    line: parts.length ? `Agent Kit: ${parts.join("; ")}.` : null,
  };
}

/** Whether `cliPath` (realpath of the running CLI) sits in a per-version node dir. */
export function cliPathInNodeManager(cliPath: string | null, platform: NodeJS.Platform): boolean {
  if (!cliPath) return false;
  return PER_VERSION_MANAGERS.has(classifyNodeManagerPath(cliPath, platform).manager);
}

export interface UpdateNoticeOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  now?: Date;
  cliVersion?: string;
  fetchImpl?: NpmFetch;
  timeoutMs?: number;
  /** Notice cache file (default beside installs.json). */
  file?: string;
  /** installs.json path (default {@link resolveInstallsFile}). */
  installsFile?: string;
  /** Path of the running CLI script (default realpath of argv[1]). */
  cliPath?: string | null;
  platform?: NodeJS.Platform;
}

/**
 * Compute the notice for `cwd` (its config can opt out). Returns null when the
 * check is off; otherwise the summary (its `line` is null when current).
 * Persists the summary for Mission Control when it changed. Never throws.
 */
export async function computeUpdateNotice(
  cwd: string,
  options: UpdateNoticeOptions = {},
): Promise<UpdateNoticeSummary | null> {
  try {
    const env = options.env ?? process.env;
    const config = await loadContextConfig(cwd).catch(() => null);
    if (!updateCheckAllowed(env, config)) return null;

    const homeDir = options.homeDir ?? homedir();
    const now = options.now ?? new Date();
    const file = options.file ?? resolveUpdateNoticeFile(env, homeDir);
    const npmLatest = await cachedCliNpmLatest({
      file,
      now,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    const installs = await listInstalls({
      file: options.installsFile ?? resolveInstallsFile(env, homeDir),
    }).catch(() => [] as InstallEntry[]);

    let cliPath = options.cliPath;
    if (cliPath === undefined) {
      cliPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
    }
    const summary = summarizeUpdateNotice({
      cliVersion: options.cliVersion ?? KIT_VERSION,
      npmLatest,
      installs,
      homeDir,
      now,
      cliInNodeManager: cliPathInNodeManager(cliPath, options.platform ?? process.platform),
    });
    await persistNotice(file, summary.line ? summary : null);
    return summary;
  } catch {
    return null;
  }
}

function sameNotice(a: UpdateNoticeSummary | null, b: UpdateNoticeSummary | null): boolean {
  const strip = (n: UpdateNoticeSummary | null) => (n ? { ...n, generatedAt: "" } : null);
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

async function persistNotice(file: string, notice: UpdateNoticeSummary | null): Promise<void> {
  const cache = await readUpdateNoticeCache(file);
  if (!cache) return;
  if (sameNotice(cache.notice ?? null, notice)) return;
  await writeUpdateNoticeCache(file, { ...cache, notice });
}
