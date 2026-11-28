import path from "node:path";
import type { AgentKitManifest } from "../manifest/types.js";
import { allSkills, loadRegistry } from "../registry/client.js";
import {
  loadPackManifest,
  type PackManifest,
  packMemberFileTargets,
  skillFileTargets,
} from "../registry/install.js";
import { UnknownPackError } from "../registry/pack-aliases.js";
import type { RegistryIndex } from "../registry/types.js";
import { L0_ARTIFACTS } from "./l0.js";
import { isRetiredSkillId } from "./retired.js";

export type ManagedOrigin = "l0" | "pack" | "skill";

export interface ManagedPair {
  /** Registry-relative source path (posix). */
  sourceRel: string;
  /** Project-relative target path (posix). */
  targetRel: string;
  origin: ManagedOrigin;
}

export interface ManagedPairs {
  /** Every managed pair in install order: L0, manifest packs, manifest skills. Not deduplicated. */
  pairs: ManagedPair[];
  /** Manifest skill ids absent from the registry index. */
  missingSkills: string[];
  /** Manifest pack ids absent from the registry index (legacy aliases resolve first). */
  missingPacks: string[];
}

const toPosix = (rel: string) => rel.split(path.sep).join("/");

/**
 * The one enumeration of kit-managed registry → project file pairs for a
 * manifest: L0 artifacts, every file of each manifest pack (skill members
 * include their companions), and every file of each manifest skill. Callers
 * apply their own dedup policy. `index` skips re-reading the registry index.
 */
export async function managedPairs(
  registryRoot: string,
  manifest: AgentKitManifest,
  index?: RegistryIndex,
): Promise<ManagedPairs> {
  const pairs: ManagedPair[] = [];
  const missingSkills: string[] = [];
  const missingPacks: string[] = [];
  const push = (sourceRel: string, targetRel: string, origin: ManagedOrigin) => {
    pairs.push({ sourceRel: toPosix(sourceRel), targetRel: toPosix(targetRel), origin });
  };

  for (const a of L0_ARTIFACTS) push(a.source, a.target, "l0");

  for (const packId of manifest.packs ?? []) {
    let pack: PackManifest;
    try {
      pack = await loadPackManifest(registryRoot, packId);
    } catch (err) {
      if (!(err instanceof UnknownPackError)) throw err;
      missingPacks.push(packId);
      continue;
    }
    for (const member of pack.members) {
      for (const { sourceRel, targetRel } of await packMemberFileTargets(registryRoot, member)) {
        push(sourceRel, targetRel, "pack");
      }
    }
  }

  if ((manifest.skills ?? []).length > 0) {
    const pool = allSkills(index ?? (await loadRegistry(registryRoot)));
    for (const id of manifest.skills ?? []) {
      if (isRetiredSkillId(id)) continue;
      const skill = pool.find((s) => s.id === id);
      if (!skill) {
        missingSkills.push(id);
        continue;
      }
      for (const { sourceRel, targetRel } of await skillFileTargets(
        registryRoot,
        skill.path,
        skill.id,
      )) {
        push(sourceRel, targetRel, "skill");
      }
    }
  }

  return { pairs, missingSkills, missingPacks };
}
