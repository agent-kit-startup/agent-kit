/**
 * Machine install registry API (`~/.config/agent-kit/installs.json`).
 * Consumers: `agent-kit installs`, the install/update/doctor feeds, and
 * `update --all` (ADR 2026-11-26_update-all-operator-only-branch-mr-per-repo).
 */

import { hasInstallManifest, type InspectOptions, inspectInstall } from "./inspect.js";
import {
  type InstallEntry,
  type InstallsStoreOptions,
  pruneInstalls,
  upsertInstalls,
} from "./store.js";

export {
  classifyInstall,
  hasInstallManifest,
  type InspectOptions,
  type InstallFacts,
  inspectInstall,
  isFactoryInstall,
  sanitizeRemote,
} from "./inspect.js";
export {
  DEFAULT_SCAN_DEPTH,
  DEFAULT_SCAN_MAX_DIRS,
  type ScanResult,
  scanForInstalls,
} from "./scan.js";
export {
  INSTALL_KINDS,
  INSTALLS_FILE_ENV,
  type InstallEntry,
  type InstallKind,
  type InstallRecord,
  type InstallsFile,
  InstallsRegistryError,
  type InstallsStoreOptions,
  listInstalls,
  readInstalls,
  resolveInstallsFile,
  upsertInstalls,
} from "./store.js";

export type RecordOptions = InstallsStoreOptions & InspectOptions;

/** Inspect `dirs` and upsert the ones that hold a kit manifest. Returns the rows written. */
export async function recordInstalls(
  dirs: readonly string[],
  options: RecordOptions = {},
): Promise<InstallEntry[]> {
  const records = [];
  for (const dir of dirs) {
    const record = await inspectInstall(dir, options);
    if (record) records.push(record);
  }
  return upsertInstalls(records, { ...options, stillInstalled: hasInstallManifest });
}

/** Remove rows whose directory or manifest is gone. Returns the removed rows. */
export function pruneMissingInstalls(options: InstallsStoreOptions = {}): Promise<InstallEntry[]> {
  return pruneInstalls({ ...options, stillInstalled: hasInstallManifest });
}

/** Lock wait for the install/update/doctor feed: short, it must never stall them. */
const FEED_LOCK_TIMEOUT_MS = 3_000;

/**
 * Fail-open feed from install, update, init and doctor: records `root` when it
 * holds a kit manifest, silently. Any error (lock timeout, unreadable or newer
 * registry file, read-only config dir) is swallowed; it never fails the command
 * and never prints (doctor --json stdout stays deterministic).
 */
export async function feedInstallsRegistry(root: string): Promise<void> {
  try {
    await recordInstalls([root], { lockTimeoutMs: FEED_LOCK_TIMEOUT_MS });
  } catch {
    // Fail open: the registry is an index, rebuildable by `agent-kit installs scan`.
  }
}
