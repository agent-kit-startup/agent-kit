/**
 * Machine install registry: `~/.config/agent-kit/installs.json`
 * (ADR 2026-08-02 amend 2026-11-26).
 *
 * - An index, never the source of truth: the repo manifest
 *   (`.cursor/agent-kit.json`) wins on conflict, so every write takes the kit
 *   version from the manifest on disk, never from a caller's memory.
 * - Never written inside a repo: the file lives in the machine config dir only.
 * - Writes go through the same owner-file + stale-reclaim lock as the registry
 *   cache (`utils/dir-lock.ts`), and publish by temp file + rename, so two
 *   concurrent writers never lose an entry.
 * - A path that no longer exists is pruned and never resurrected: every write
 *   re-reads the file under the lock and only adds rows it just verified.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { acquireDirLock } from "../utils/dir-lock.js";

export const INSTALLS_SCHEMA_VERSION = 1 as const;
export const INSTALLS_FILENAME = "installs.json";
/** Env override for the registry file (tests and scratch runs). */
export const INSTALLS_FILE_ENV = "AGENT_KIT_INSTALLS_FILE";

/**
 * - `repo`: a regular consumer checkout.
 * - `worktree`: a linked git worktree (its git-dir differs from git-common-dir).
 * - `fixture`: a manifest that is not its own repository (test fixtures, temp dirs).
 * - `factory`: the kit's own repository and its worktrees (pseudo-consumer,
 *   ADR 2026-07-31); wins over `worktree`.
 * - `home`: the home-level install under `~/.cursor`.
 */
export type InstallKind = "repo" | "worktree" | "fixture" | "factory" | "home";

export const INSTALL_KINDS: readonly InstallKind[] = [
  "repo",
  "worktree",
  "fixture",
  "factory",
  "home",
];

export interface InstallEntry {
  /** Absolute real path of the directory holding `.cursor/agent-kit.json`. */
  path: string;
  /** `origin` URL without credentials, or null when the repo has none. */
  remote: string | null;
  /** `version` of the repo manifest when last seen. */
  kitVersion: string | null;
  /** Version of the CLI that last recorded this row. */
  cliVersion: string;
  /** ISO timestamp of the last time a CLI saw this install. */
  lastSeen: string;
  kind: InstallKind;
}

export interface InstallsFile {
  schemaVersion: typeof INSTALLS_SCHEMA_VERSION;
  installs: InstallEntry[];
  /**
   * Rows this CLI cannot read (for example a kind a newer CLI added). Hidden
   * from listings, written back verbatim by every write unless a recognized
   * row for the same path replaces them.
   */
  unrecognized?: unknown[];
}

export interface InstallsStoreOptions {
  /** Registry file path; defaults to {@link resolveInstallsFile}. */
  file?: string;
  /** Lock wait for writes (default 60 s; feeds pass a short one). */
  lockTimeoutMs?: number;
}

export class InstallsRegistryError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "InstallsRegistryError";
  }
}

/**
 * `$AGENT_KIT_INSTALLS_FILE`, else `$XDG_CONFIG_HOME/agent-kit/installs.json`
 * (absolute values only, per the XDG spec), else `~/.config/agent-kit/installs.json`.
 */
export function resolveInstallsFile(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env[INSTALLS_FILE_ENV]?.trim();
  if (override) return path.resolve(override);
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const configDir = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".config");
  return path.join(configDir, "agent-kit", INSTALLS_FILENAME);
}

function isInstallEntry(value: unknown): value is InstallEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.path === "string" &&
    path.isAbsolute(e.path) &&
    (e.remote === null || typeof e.remote === "string") &&
    (e.kitVersion === null || typeof e.kitVersion === "string") &&
    typeof e.cliVersion === "string" &&
    typeof e.lastSeen === "string" &&
    INSTALL_KINDS.includes(e.kind as InstallKind)
  );
}

/** Parse the file body. Throws {@link InstallsRegistryError} when it is not ours to rewrite. */
export function parseInstallsFile(raw: string, file: string): InstallsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InstallsRegistryError(
      `${file} is not valid JSON; move it aside and run \`agent-kit installs scan\` to rebuild it.`,
      file,
    );
  }
  const body = parsed as { schemaVersion?: unknown; installs?: unknown };
  if (!body || typeof body !== "object" || !Array.isArray(body.installs)) {
    throw new InstallsRegistryError(
      `${file} has no installs list; move it aside and run \`agent-kit installs scan\` to rebuild it.`,
      file,
    );
  }
  if (body.schemaVersion !== INSTALLS_SCHEMA_VERSION) {
    throw new InstallsRegistryError(
      `${file} has schemaVersion ${String(body.schemaVersion)}; this CLI understands ${INSTALLS_SCHEMA_VERSION} (newer CLI?). Left untouched.`,
      file,
    );
  }
  const installs = body.installs.filter(isInstallEntry);
  const unrecognized = body.installs.filter((row) => !isInstallEntry(row));
  return { schemaVersion: INSTALLS_SCHEMA_VERSION, installs, unrecognized };
}

/** Read the registry. A missing file is an empty registry; nothing is created. */
export async function readInstalls(options: InstallsStoreOptions = {}): Promise<InstallsFile> {
  const file = options.file ?? resolveInstallsFile();
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: INSTALLS_SCHEMA_VERSION, installs: [] };
    }
    throw err;
  }
  return parseInstallsFile(raw, file);
}

/** Entries sorted by path. Read-only: takes no lock and writes nothing. */
export async function listInstalls(options: InstallsStoreOptions = {}): Promise<InstallEntry[]> {
  const { installs } = await readInstalls(options);
  return [...installs].sort((a, b) => a.path.localeCompare(b.path));
}

async function writeInstallsFile(file: string, body: InstallsFile): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const known = new Set(body.installs.map((e) => e.path));
  const kept = (body.unrecognized ?? []).filter((row) => {
    const rowPath = (row as { path?: unknown } | null)?.path;
    return !(typeof rowPath === "string" && known.has(rowPath));
  });
  const sorted = {
    schemaVersion: INSTALLS_SCHEMA_VERSION,
    installs: [...[...body.installs].sort((a, b) => a.path.localeCompare(b.path)), ...kept],
  };
  try {
    await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Read-modify-write under the lock. `mutate` sees the file as it is on disk
 * now (never a snapshot taken before the lock) and returns the new list.
 */
async function mutateInstalls<T>(
  options: InstallsStoreOptions,
  mutate: (
    current: InstallEntry[],
  ) => Promise<{ installs: InstallEntry[]; result: T; changed: boolean }>,
): Promise<T> {
  const file = options.file ?? resolveInstallsFile();
  const unlock = await acquireDirLock(file, {
    timeoutMs: options.lockTimeoutMs,
    timeoutMessage: (target) =>
      `Timed out waiting for the install registry lock on ${target}. Another agent-kit process may be stuck.`,
  });
  try {
    const current = await readInstalls({ file });
    const { installs, result, changed } = await mutate(current.installs);
    if (changed) {
      await writeInstallsFile(file, {
        schemaVersion: INSTALLS_SCHEMA_VERSION,
        installs,
        unrecognized: current.unrecognized,
      });
    }
    return result;
  } finally {
    await unlock();
  }
}

/** A row to record; `lastSeen` defaults to now. */
export type InstallRecord = Omit<InstallEntry, "lastSeen"> & { lastSeen?: string };

export interface UpsertOptions extends InstallsStoreOptions {
  /**
   * Re-checked under the lock for each record: a row whose install vanished
   * since it was inspected is not written (prune never resurrects).
   */
  stillInstalled?: (installPath: string) => Promise<boolean>;
  now?: () => Date;
}

/** Insert or replace rows by path. Returns the rows written. */
export async function upsertInstalls(
  records: readonly InstallRecord[],
  options: UpsertOptions = {},
): Promise<InstallEntry[]> {
  if (records.length === 0) return [];
  const now = (options.now ?? (() => new Date()))().toISOString();
  return mutateInstalls(options, async (current) => {
    const byPath = new Map(current.map((e) => [e.path, e]));
    const written: InstallEntry[] = [];
    for (const record of records) {
      if (options.stillInstalled && !(await options.stillInstalled(record.path))) continue;
      const entry: InstallEntry = {
        path: record.path,
        remote: record.remote,
        kitVersion: record.kitVersion,
        cliVersion: record.cliVersion,
        lastSeen: record.lastSeen ?? now,
        kind: record.kind,
      };
      if (!isInstallEntry(entry)) continue;
      byPath.set(entry.path, entry);
      written.push(entry);
    }
    return { installs: [...byPath.values()], result: written, changed: written.length > 0 };
  });
}

export interface PruneOptions extends InstallsStoreOptions {
  /** True when the row's install still exists (default: manifest present). */
  stillInstalled: (installPath: string) => Promise<boolean>;
}

/** Drop rows whose install is gone. Returns the removed rows. */
export async function pruneInstalls(options: PruneOptions): Promise<InstallEntry[]> {
  return mutateInstalls(options, async (current) => {
    const kept: InstallEntry[] = [];
    const removed: InstallEntry[] = [];
    for (const entry of current) {
      if (await options.stillInstalled(entry.path)) kept.push(entry);
      else removed.push(entry);
    }
    return { installs: kept, result: removed, changed: removed.length > 0 };
  });
}
