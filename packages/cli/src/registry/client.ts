import path from "node:path";
import { readJson } from "../utils/fs.js";
import { legacyPackIdTarget, type PackIdRewrite, UnknownPackError } from "./pack-aliases.js";
import { REGISTRY_INDEX_REL } from "./paths.js";
import type {
  RegistryArtifact,
  RegistryIndex,
  RegistryPackSummary,
  RegistrySkill,
} from "./types.js";

export async function loadRegistry(rootDir: string): Promise<RegistryIndex> {
  const indexPath = path.join(rootDir, REGISTRY_INDEX_REL);
  const index = await readJson<RegistryIndex>(indexPath);
  if (!index) throw new Error(`Registry not found at ${indexPath}`);
  return index;
}

export function allSkills(index: RegistryIndex): RegistrySkill[] {
  return [...index.skills.core, ...index.skills.community];
}

export function allPacks(index: RegistryIndex): RegistryPackSummary[] {
  return index.packs ?? [];
}

export function allArtifacts(index: RegistryIndex): RegistryArtifact[] {
  return index.artifacts ?? [];
}

export async function findSkill(rootDir: string, skillId: string): Promise<RegistrySkill> {
  const index = await loadRegistry(rootDir);
  const skill = allSkills(index).find((item) => item.id === skillId);
  if (!skill) throw new Error(`Skill '${skillId}' not found in registry.`);
  return skill;
}

/**
 * Look a pack up by id: an exact registry id first, then the legacy alias
 * (`LEGACY_PACK_ID_ALIASES`). Undefined when neither ships.
 */
export function resolvePackSummary(
  index: RegistryIndex,
  packId: string,
): RegistryPackSummary | undefined {
  const packs = allPacks(index);
  const exact = packs.find((item) => item.id === packId);
  if (exact) return exact;
  const alias = legacyPackIdTarget(packId);
  return alias ? packs.find((item) => item.id === alias) : undefined;
}

/** Resolve a pack id (legacy aliases included); throws `UnknownPackError` when absent. */
export async function findPack(rootDir: string, packId: string): Promise<RegistryPackSummary> {
  const index = await loadRegistry(rootDir);
  const pack = resolvePackSummary(index, packId);
  if (!pack)
    throw new UnknownPackError(
      packId,
      allPacks(index).map((item) => item.id),
    );
  return pack;
}

export interface CanonicalPackIds {
  /** Pack ids with legacy aliases replaced by the id the registry ships; order kept, deduplicated. */
  packs: string[] | undefined;
  /** One entry per legacy id that resolved to a different registry id. */
  rewrites: PackIdRewrite[];
  /** Ids the registry does not ship under any alias (kept in `packs`). */
  unknown: string[];
  /** Every pack id in the registry index. */
  knownIds: string[];
}

/** Map manifest pack ids to the ids the registry resolves them to. */
export async function canonicalizePackIds(
  rootDir: string,
  packIds: readonly string[] | undefined,
): Promise<CanonicalPackIds> {
  const index = await loadRegistry(rootDir);
  const knownIds = allPacks(index).map((item) => item.id);
  if (!packIds) return { packs: undefined, rewrites: [], unknown: [], knownIds };
  const packs: string[] = [];
  const rewrites: PackIdRewrite[] = [];
  const unknown: string[] = [];
  for (const id of packIds) {
    const summary = resolvePackSummary(index, id);
    if (!summary) unknown.push(id);
    else if (summary.id !== id) rewrites.push({ from: id, to: summary.id });
    const resolved = summary?.id ?? id;
    if (!packs.includes(resolved)) packs.push(resolved);
  }
  return { packs, rewrites, unknown, knownIds };
}

export async function findArtifact(
  rootDir: string,
  kind: RegistryArtifact["kind"],
  id: string,
): Promise<RegistryArtifact> {
  const index = await loadRegistry(rootDir);
  const artifact = allArtifacts(index).find((item) => item.kind === kind && item.id === id);
  if (!artifact) throw new Error(`Artifact '${kind}:${id}' not found in registry.`);
  return artifact;
}

/** Resolve add target: skill or pack. Throws if the same id exists as both. */
export async function resolveAddTarget(
  rootDir: string,
  id: string,
): Promise<{ type: "skill"; skill: RegistrySkill } | { type: "pack"; pack: RegistryPackSummary }> {
  const index = await loadRegistry(rootDir);
  const skill = allSkills(index).find((item) => item.id === id);
  const pack = resolvePackSummary(index, id);
  if (skill && pack) {
    throw new Error(
      `'${id}' is both a skill and a pack. Disambiguate: agent-kit add --skill ${id} | agent-kit add --pack ${id}`,
    );
  }
  if (skill) return { type: "skill", skill };
  if (pack) return { type: "pack", pack };
  throw new Error(`'${id}' not found as skill or pack in registry.`);
}
