import path from "node:path";
import { readJson } from "../utils/fs.js";
import type {
  RegistryArtifact,
  RegistryIndex,
  RegistryPackSummary,
  RegistrySkill,
} from "./types.js";

export async function loadRegistry(rootDir: string): Promise<RegistryIndex> {
  const indexPath = path.join(rootDir, "registry", "registry.json");
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

export async function findPack(rootDir: string, packId: string): Promise<RegistryPackSummary> {
  const index = await loadRegistry(rootDir);
  const pack = allPacks(index).find((item) => item.id === packId);
  if (!pack) throw new Error(`Pack '${packId}' not found in registry.`);
  return pack;
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
  const pack = allPacks(index).find((item) => item.id === id);
  if (skill && pack) {
    throw new Error(
      `'${id}' is both a skill and a pack. Disambiguate: agent-kit add --skill ${id} | agent-kit add --pack ${id}`,
    );
  }
  if (skill) return { type: "skill", skill };
  if (pack) return { type: "pack", pack };
  throw new Error(`'${id}' not found as skill or pack in registry.`);
}
