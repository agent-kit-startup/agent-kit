import type { AgentKitManifest } from "../manifest/types.js";
import { allSkills, findSkill, loadRegistry } from "../registry/client.js";
import { installPack, installSkill, installSkillsByIds } from "../registry/install.js";
import {
  type ApplyStats,
  copyRegistryFile,
  emptyStats,
  mergeStats,
  recordOutcome,
} from "./apply.js";
import { L0_ARTIFACTS } from "./l0.js";
import { resolveProtectedGlobs } from "./protected.js";

export async function installL0(
  registryRoot: string,
  projectRoot: string,
  protectedGlobs: readonly string[],
): Promise<ApplyStats> {
  const stats = emptyStats();
  for (const artifact of L0_ARTIFACTS) {
    const outcome = await copyRegistryFile(
      registryRoot,
      projectRoot,
      artifact.source,
      artifact.target,
      protectedGlobs,
    );
    recordOutcome(stats, artifact.target, outcome);
  }
  return stats;
}

/** Re-apply L0 + manifest packs + manifest skills (skips protected). */
export async function syncFromManifest(
  registryRoot: string,
  projectRoot: string,
  manifest: AgentKitManifest,
): Promise<ApplyStats> {
  const protectedGlobs = resolveProtectedGlobs(manifest);
  const stats = emptyStats();

  mergeStats(stats, await installL0(registryRoot, projectRoot, protectedGlobs));

  for (const packId of manifest.packs ?? []) {
    mergeStats(stats, await installPack(registryRoot, projectRoot, packId, { protectedGlobs }));
  }

  const skillIds = manifest.skills ?? [];
  if (skillIds.length > 0) {
    await loadRegistry(registryRoot);
    mergeStats(
      stats,
      await installSkillsByIds(registryRoot, projectRoot, skillIds, { protectedGlobs }),
    );
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
