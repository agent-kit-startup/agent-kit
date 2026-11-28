import type { AgentKitManifest } from "../manifest/types.js";
import { allSkills, findSkill, loadRegistry } from "../registry/client.js";
import { installPack, installSkill, installSkillsByIds } from "../registry/install.js";
import { UnknownPackError } from "../registry/pack-aliases.js";
import { logger } from "../utils/logger.js";
import {
  type ApplyStats,
  copyRegistryFile,
  emptyStats,
  mergeStats,
  recordOutcome,
} from "./apply.js";
import { L0_ARTIFACTS } from "./l0.js";
import { migrateLegacyOnboardCommand } from "./onboard-migration.js";
import { loadManagedHashLedger, type ManagedHashLedger, saveManagedHashLedger } from "./overlay.js";
import { resolveProtectedGlobs } from "./protected.js";
import { isRetiredSkillId, retireManagedFiles } from "./retired.js";

export async function installL0(
  registryRoot: string,
  projectRoot: string,
  protectedGlobs: readonly string[],
  ledger?: ManagedHashLedger,
): Promise<ApplyStats> {
  const stats = emptyStats();
  const managedHashes = ledger ?? (await loadManagedHashLedger(projectRoot));
  const copyOpts = { managedHashes, persistManagedHashes: false as const };
  for (const artifact of L0_ARTIFACTS) {
    const outcome = await copyRegistryFile(
      registryRoot,
      projectRoot,
      artifact.source,
      artifact.target,
      protectedGlobs,
      copyOpts,
    );
    recordOutcome(stats, artifact.target, outcome);
  }
  for (const retired of await retireManagedFiles(projectRoot, protectedGlobs, managedHashes)) {
    if (retired.outcome === "removed") stats.removed.push(retired.path);
    else if (retired.outcome === "preserved-customized") stats.collisions.push(retired.path);
  }
  // Save after the retirement so a removed file drops out of the ledger.
  if (!ledger) await saveManagedHashLedger(projectRoot, managedHashes);
  const migration = await migrateLegacyOnboardCommand(projectRoot);
  if (migration === "removed-managed") {
    stats.removed.push(".cursor/commands/onboard.md");
  } else if (migration === "preserved-customized") {
    stats.collisions.push(".cursor/commands/onboard.md");
  }
  return stats;
}

export interface SyncOptions {
  /** Receives the named warning for a manifest pack id the registry does not ship. */
  onWarning?: (message: string) => void;
}

/**
 * Re-apply L0 + manifest packs + manifest skills (skips protected). The
 * managed-hash ledger is read once up front and saved once at the end. A pack
 * id the registry does not ship (legacy aliases resolve) is skipped with a
 * named warning and recorded as `pack:<id>` in `missing`, like a missing skill.
 */
export async function syncFromManifest(
  registryRoot: string,
  projectRoot: string,
  manifest: AgentKitManifest,
  options: SyncOptions = {},
): Promise<ApplyStats> {
  const onWarning = options.onWarning ?? ((message: string) => logger.warn(message));
  const protectedGlobs = resolveProtectedGlobs(manifest);
  const stats = emptyStats();
  const managedHashes = await loadManagedHashLedger(projectRoot);
  const installOpts = { protectedGlobs, managedHashes };

  try {
    mergeStats(stats, await installL0(registryRoot, projectRoot, protectedGlobs, managedHashes));

    for (const packId of manifest.packs ?? []) {
      try {
        mergeStats(stats, await installPack(registryRoot, projectRoot, packId, installOpts));
      } catch (err) {
        if (!(err instanceof UnknownPackError)) throw err;
        onWarning(err.message);
        stats.missing.push(`pack:${packId}`);
      }
    }

    const skillIds = (manifest.skills ?? []).filter((id) => !isRetiredSkillId(id));
    if (skillIds.length > 0) {
      await loadRegistry(registryRoot);
      mergeStats(stats, await installSkillsByIds(registryRoot, projectRoot, skillIds, installOpts));
    }
  } finally {
    // Persist hashes for files already written even when a later step throws.
    await saveManagedHashLedger(projectRoot, managedHashes);
  }
  return stats;
}

export async function addSkillToProject(
  registryRoot: string,
  projectRoot: string,
  skillId: string,
  protectedGlobs: readonly string[],
): Promise<ApplyStats> {
  const skill = await findSkill(registryRoot, skillId);
  return installSkill(registryRoot, projectRoot, skill, { protectedGlobs });
}

export async function listCatalogSkillIds(registryRoot: string): Promise<string[]> {
  const index = await loadRegistry(registryRoot);
  return allSkills(index).map((s) => s.id);
}
