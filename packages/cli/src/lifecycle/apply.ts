import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentKitManifest } from "../manifest/types.js";
import {
  DEFAULT_PROTECTED_PATHS,
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA_VERSION,
} from "../manifest/types.js";
import { writeJson } from "../utils/fs.js";
import {
  type ManagedHashLedger,
  contentHash,
  isConsumerOverlayPath,
  loadManagedHashLedger,
  saveManagedHashLedger,
  shouldPreserveCustomizedOverlay,
} from "./overlay.js";
import {
  assertRealContained,
  assertRealParentContained,
  resolveContained,
  toPosixRel,
} from "./paths.js";
import { isProtectedPath, normalizeProtectedGlobs } from "./protected.js";

export type CopyOutcome =
  | "written"
  | "skipped-protected"
  | "missing-source"
  | "unchanged"
  | "preserved-customized"
  | "skipped-symlink";

export interface ApplyStats {
  written: string[];
  removed: string[];
  collisions: string[];
  skippedProtected: string[];
  missing: string[];
  unchanged: string[];
  preservedCustomized: string[];
  skippedSymlink: string[];
}

export function emptyStats(): ApplyStats {
  return {
    written: [],
    removed: [],
    collisions: [],
    skippedProtected: [],
    missing: [],
    unchanged: [],
    preservedCustomized: [],
    skippedSymlink: [],
  };
}

export function mergeStats(into: ApplyStats, from: ApplyStats): ApplyStats {
  into.written.push(...from.written);
  into.removed.push(...from.removed);
  into.collisions.push(...from.collisions);
  into.skippedProtected.push(...from.skippedProtected);
  into.missing.push(...from.missing);
  into.unchanged.push(...from.unchanged);
  into.preservedCustomized.push(...from.preservedCustomized);
  into.skippedSymlink.push(...from.skippedSymlink);
  return into;
}

export interface CopyRegistryOptions {
  /** When set, overlay ledger is read/written once by the caller across many copies. */
  managedHashes?: ManagedHashLedger;
  /** Persist ledger after mutation (default true when managedHashes provided or auto-loaded). */
  persistManagedHashes?: boolean;
}

/**
 * Copy a file from registry root → project root, skipping L3 protected paths.
 * Consumer overlay paths (agents/skills/commands/hooks/scripts) preserve local customizations
 * when the local hash diverges from the managed ledger (or, when the ledger is
 * absent, when local content is not a known shipped kit hash); unedited kit
 * files refresh.
 */
export async function copyRegistryFile(
  registryRoot: string,
  projectRoot: string,
  sourceRel: string,
  targetRel: string,
  protectedGlobs: readonly string[],
  options: CopyRegistryOptions = {},
): Promise<CopyOutcome> {
  const targetNorm = targetRel.split(path.sep).join("/");
  if (isProtectedPath(targetNorm, protectedGlobs)) {
    return "skipped-protected";
  }

  const sourceAbs = resolveContained(registryRoot, sourceRel);
  const targetAbs = resolveContained(projectRoot, targetRel);

  // Lexical containment above does not stop a symlink from pointing outside
  // the registry/project; never read or overwrite through one.
  for (const [root, abs] of [
    [registryRoot, sourceAbs],
    [projectRoot, targetAbs],
  ] as const) {
    const contained = (await pathExists(abs))
      ? await isRealContained(root, abs)
      : await isRealParentContained(root, abs);
    if (!contained) return "skipped-symlink";
  }

  try {
    await readFile(sourceAbs);
  } catch {
    return "missing-source";
  }

  let existing: string | null = null;
  try {
    existing = await readFile(targetAbs, "utf8");
  } catch {
    existing = null;
  }
  const next = await readFile(sourceAbs, "utf8");
  if (existing === next) {
    if (isConsumerOverlayPath(targetNorm)) {
      await touchOverlayHash(projectRoot, targetNorm, next, options);
    }
    return "unchanged";
  }

  if (existing !== null && isConsumerOverlayPath(targetNorm)) {
    const ledger = options.managedHashes ?? (await loadManagedHashLedger(projectRoot));
    const recorded = ledger.hashes[targetNorm];
    if (shouldPreserveCustomizedOverlay(existing, recorded)) {
      // Ledger tracks last-managed kit content, not the local body. On
      // ledger-absent preserve, seed with incoming kit hash so subsequent
      // updates still see local≠managed and keep preserving.
      if (!recorded) {
        const managedHash = contentHash(next);
        ledger.hashes[targetNorm] = managedHash;
        if (options.managedHashes) {
          options.managedHashes.hashes[targetNorm] = managedHash;
        }
        if (options.persistManagedHashes !== false) {
          await saveManagedHashLedger(projectRoot, ledger);
        }
      }
      return "preserved-customized";
    }
    await mkdir(path.dirname(targetAbs), { recursive: true });
    await copyFile(sourceAbs, targetAbs);
    ledger.hashes[targetNorm] = contentHash(next);
    if (options.managedHashes) {
      options.managedHashes.hashes[targetNorm] = ledger.hashes[targetNorm];
    }
    if (options.persistManagedHashes !== false) {
      await saveManagedHashLedger(projectRoot, ledger);
    }
    return "written";
  }

  await mkdir(path.dirname(targetAbs), { recursive: true });
  await copyFile(sourceAbs, targetAbs);
  if (isConsumerOverlayPath(targetNorm)) {
    await touchOverlayHash(projectRoot, targetNorm, next, options);
  }
  return "written";
}

async function isRealContained(root: string, abs: string): Promise<boolean> {
  try {
    await assertRealContained(root, abs);
    return true;
  } catch {
    return false;
  }
}

async function isRealParentContained(root: string, abs: string): Promise<boolean> {
  try {
    await assertRealParentContained(root, abs);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  } catch {
    return false;
  }
}

async function touchOverlayHash(
  projectRoot: string,
  targetNorm: string,
  content: string,
  options: CopyRegistryOptions,
): Promise<void> {
  const ledger = options.managedHashes ?? (await loadManagedHashLedger(projectRoot));
  const hash = contentHash(content);
  if (ledger.hashes[targetNorm] === hash) return;
  ledger.hashes[targetNorm] = hash;
  if (options.managedHashes) {
    options.managedHashes.hashes[targetNorm] = hash;
  }
  if (options.persistManagedHashes !== false) {
    await saveManagedHashLedger(projectRoot, ledger);
  }
}

export function recordOutcome(stats: ApplyStats, targetRel: string, outcome: CopyOutcome): void {
  const rel = targetRel.split(path.sep).join("/");
  switch (outcome) {
    case "written":
      stats.written.push(rel);
      break;
    case "skipped-protected":
      stats.skippedProtected.push(rel);
      break;
    case "missing-source":
      stats.missing.push(rel);
      break;
    case "unchanged":
      stats.unchanged.push(rel);
      break;
    case "preserved-customized":
      stats.preservedCustomized.push(rel);
      break;
    case "skipped-symlink":
      stats.skippedSymlink.push(rel);
      break;
  }
}

export async function saveManifest(
  projectRoot: string,
  manifest: AgentKitManifest,
): Promise<string> {
  const target = path.join(projectRoot, MANIFEST_RELATIVE_PATH);
  const { unknownFields, ...known } = manifest;
  const payload: Record<string, unknown> = {
    ...known,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    // Preserve installedAt on no-op updates (ADR factory-pseudo-consumer
    // decision 4); a version change earns a fresh install timestamp.
    installedAt: manifest.installedAt ?? new Date().toISOString(),
  };
  // Write fields a newer CLI added back after the known ones, so an older CLI
  // never deletes them; a known key always wins over a same-named extra.
  for (const [key, value] of Object.entries(unknownFields ?? {})) {
    if (!(key in payload)) payload[key] = value;
  }
  await writeJson(target, payload);
  return toPosixRel(projectRoot, target);
}

export function buildManifest(input: {
  version: string;
  profile?: string;
  packs?: string[];
  skills?: string[];
  protected?: string[];
  personalization?: AgentKitManifest["personalization"];
  registryUrl?: string;
  registryRef?: string;
}): AgentKitManifest {
  const manifest: AgentKitManifest = {
    schemaVersion: 1,
    version: input.version,
    protected: normalizeProtectedGlobs(input.protected ?? [...DEFAULT_PROTECTED_PATHS]),
  };
  if (input.profile) manifest.profile = input.profile;
  if (input.packs?.length) manifest.packs = [...new Set(input.packs)].sort();
  if (input.skills?.length) manifest.skills = [...new Set(input.skills)].sort();
  if (input.personalization) manifest.personalization = input.personalization;
  if (input.registryUrl || input.registryRef) {
    manifest.registry = {};
    if (input.registryUrl) manifest.registry.url = input.registryUrl;
    if (input.registryRef) manifest.registry.ref = input.registryRef;
  }
  return manifest;
}

export function upsertIdList(list: string[] | undefined, id: string): string[] {
  return [...new Set([...(list ?? []), id])].sort();
}
