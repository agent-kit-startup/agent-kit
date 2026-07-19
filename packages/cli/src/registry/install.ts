import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ApplyStats,
  copyRegistryFile,
  emptyStats,
  mergeStats,
  recordOutcome,
} from "../lifecycle/apply.js";
import { resolveContained } from "../lifecycle/paths.js";
import { readJson } from "../utils/fs.js";
import { allSkills, findPack, loadRegistry } from "./client.js";
import type { RegistryIndex, RegistrySkill } from "./types.js";

export interface PackMember {
  kind: "rule" | "skill" | "agent" | "command" | "hook" | "template";
  id: string;
  source: string;
}

export interface PackManifest {
  schemaVersion: number;
  id: string;
  title: string;
  description: string;
  version: string;
  members: PackMember[];
  excludes?: string[];
}

export interface InstallOptions {
  protectedGlobs?: readonly string[];
}

function targetForMember(member: PackMember): { sourceRel: string; targetRel: string } {
  switch (member.kind) {
    case "skill": {
      const category = member.source.includes("/core/") ? "core" : "community";
      return {
        sourceRel: path.posix.join(member.source, "SKILL.md"),
        targetRel: path.posix.join(".cursor", "skills", category, member.id, "SKILL.md"),
      };
    }
    case "rule":
      return {
        sourceRel: member.source,
        targetRel: path.posix.join(".cursor", "rules", path.posix.basename(member.source)),
      };
    case "agent":
      return {
        sourceRel: member.source,
        targetRel: path.posix.join(".cursor", "agents", path.posix.basename(member.source)),
      };
    case "command":
      return {
        sourceRel: member.source,
        targetRel: path.posix.join(".cursor", "commands", path.posix.basename(member.source)),
      };
    case "hook": {
      const targetRel = member.source.startsWith(".cursor/")
        ? member.source
        : path.posix.join(".cursor", "hooks", path.posix.basename(member.source));
      return { sourceRel: member.source, targetRel };
    }
    case "template": {
      const base = path.posix.basename(member.source);
      // Context / architecture scaffolds install under .cursor/context/templates/
      if (
        member.source.includes("/context-management/") ||
        member.source.includes("/engineering-architecture/")
      ) {
        return {
          sourceRel: member.source,
          targetRel: path.posix.join(".cursor", "context", "templates", base),
        };
      }
      // DevOps scaffolding (CI, CODEOWNERS) installs under project templates/
      return {
        sourceRel: member.source,
        targetRel: path.posix.join("templates", base),
      };
    }
    default: {
      const _exhaustive: never = member.kind;
      throw new Error(`Unsupported pack member kind: ${_exhaustive}`);
    }
  }
}

/** Install a skill from registryRoot into projectRoot `.cursor/skills/`. */
export async function installSkill(
  registryRoot: string,
  projectRoot: string,
  skill: RegistrySkill,
  options: InstallOptions = {},
): Promise<ApplyStats> {
  const stats = emptyStats();
  const category = skill.path.includes("/core/") ? "core" : "community";
  const sourceRel = path.posix.join(skill.path, "SKILL.md");
  const targetRel = path.posix.join(".cursor", "skills", category, skill.id, "SKILL.md");
  const outcome = await copyRegistryFile(
    registryRoot,
    projectRoot,
    sourceRel,
    targetRel,
    options.protectedGlobs ?? [],
  );
  recordOutcome(stats, targetRel, outcome);
  return stats;
}

/**
 * When `registry/registry.json` exists under registryRoot, copies each matching skill
 * into project `.cursor/skills/`.
 */
export async function installSkillsByIds(
  registryRoot: string,
  projectRoot: string,
  skillIds: string[],
  options: InstallOptions = {},
): Promise<ApplyStats> {
  const index = await readJson<RegistryIndex>(path.join(registryRoot, "registry", "registry.json"));
  const stats = emptyStats();
  if (!index) return stats;

  const pool = allSkills(index);
  for (const id of skillIds) {
    const skill = pool.find((s) => s.id === id);
    if (!skill) {
      stats.missing.push(id);
      continue;
    }
    mergeStats(stats, await installSkill(registryRoot, projectRoot, skill, options));
  }
  return stats;
}

export async function loadPackManifest(
  registryRoot: string,
  packId: string,
): Promise<PackManifest> {
  const summary = await findPack(registryRoot, packId);
  const manifestPath = resolveContained(registryRoot, path.join(summary.path, "pack.json"));
  const manifest = await readJson<PackManifest>(manifestPath);
  if (!manifest) throw new Error(`Pack manifest not found at ${manifestPath}`);
  return manifest;
}

/** Install all members of an L1 pack into project `.cursor/`. */
export async function installPack(
  registryRoot: string,
  projectRoot: string,
  packId: string,
  options: InstallOptions = {},
): Promise<ApplyStats> {
  await loadRegistry(registryRoot);
  const packManifest = await loadPackManifest(registryRoot, packId);
  const stats = emptyStats();
  const protectedGlobs = options.protectedGlobs ?? [];

  for (const member of packManifest.members) {
    const { sourceRel, targetRel } = targetForMember(member);
    const outcome = await copyRegistryFile(
      registryRoot,
      projectRoot,
      sourceRel,
      targetRel,
      protectedGlobs,
    );
    recordOutcome(stats, targetRel, outcome);
  }
  return stats;
}

/** Read pack.json from disk without requiring registry index (for build scripts / tests). */
export async function readPackJson(packDir: string): Promise<PackManifest> {
  const raw = await readFile(path.join(packDir, "pack.json"), "utf8");
  return JSON.parse(raw) as PackManifest;
}

/** Paths a pack would write (for diff). */
export function packMemberTargets(member: PackMember): { sourceRel: string; targetRel: string } {
  return targetForMember(member);
}
