import { copyFile, mkdir, readFile } from "node:fs/promises";
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
import { resolveContained, toPosixRel } from "./paths.js";
import { isProtectedPath, normalizeProtectedGlobs } from "./protected.js";

export type CopyOutcome =
  | "written"
  | "skipped-protected"
  | "missing-source"
  | "unchanged"
  | "preserved-customized";

export interface ApplyStats {
  written: string[];
  removed: string[];
  collisions: string[];
  skippedProtected: string[];
  missing: string[];
  unchanged: string[];
  preservedCustomized: string[];
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
 * Consumer overlay paths (agents/skills/commands) preserve local customizations
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
  }
}

export async function saveManifest(
  projectRoot: string,
  manifest: AgentKitManifest,
): Promise<string> {
  const target = path.join(projectRoot, MANIFEST_RELATIVE_PATH);
  const payload = {
    ...manifest,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    // Preserve installedAt on no-op updates (ADR factory-pseudo-consumer
    // decision 4); a version change earns a fresh install timestamp.
    installedAt: manifest.installedAt ?? new Date().toISOString(),
  };
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
