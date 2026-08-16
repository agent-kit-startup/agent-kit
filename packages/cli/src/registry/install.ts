import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  type ApplyStats,
  copyRegistryFile,
  emptyStats,
  mergeStats,
  recordOutcome,
} from "../lifecycle/apply.js";
import { loadManagedHashLedger, saveManagedHashLedger } from "../lifecycle/overlay.js";
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

/** Where a skill's files land in a consumer tree: `.cursor/skills/<category>/<id>/`. */
export function skillTargetDir(skillPath: string, skillId: string): string {
  const category = skillPath.includes("/core/") ? "core" : "community";
  return path.posix.join(".cursor", "skills", category, skillId);
}

/**
 * Every file a skill ships, not just `SKILL.md`.
 *
 * Skills may carry companion files next to their entry point (checklists,
 * references, fixtures). Enumerating the source directory keeps those files in
 * the install/diff set instead of leaving the links in `SKILL.md` dangling in
 * every consumer tree. `SKILL.md` is required and always comes first; hidden
 * files are ignored. A missing or unreadable directory yields the `SKILL.md`
 * pair alone, so callers behave exactly as before on a registry that has none.
 */
export async function skillFileTargets(
  registryRoot: string,
  skillPath: string,
  skillId: string,
): Promise<{ sourceRel: string; targetRel: string }[]> {
  const targetDir = skillTargetDir(skillPath, skillId);
  const pair = (rel: string) => ({
    sourceRel: path.posix.join(skillPath, rel),
    targetRel: path.posix.join(targetDir, rel),
  });

  let companions: string[] = [];
  try {
    const dirAbs = resolveContained(registryRoot, skillPath);
    const entries = await readdir(dirAbs, { withFileTypes: true, recursive: true });
    companions = entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const parent = path.relative(dirAbs, entry.parentPath ?? dirAbs);
        return path.join(parent, entry.name).split(path.sep).join("/");
      })
      .filter((rel) => rel !== "SKILL.md" && !rel.split("/").some((seg) => seg.startsWith(".")))
      .sort();
  } catch {
    companions = [];
  }

  return [pair("SKILL.md"), ...companions.map(pair)];
}

function targetForMember(member: PackMember): { sourceRel: string; targetRel: string } {
  switch (member.kind) {
    case "skill":
      // Entry point only. Companion files come from skillFileTargets(); callers
      // that install or diff a skill must use it instead of this single pair.
      return {
        sourceRel: path.posix.join(member.source, "SKILL.md"),
        targetRel: path.posix.join(skillTargetDir(member.source, member.id), "SKILL.md"),
      };
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
  const managedHashes = await loadManagedHashLedger(projectRoot);
  for (const { sourceRel, targetRel } of await skillFileTargets(
    registryRoot,
    skill.path,
    skill.id,
  )) {
    const outcome = await copyRegistryFile(
      registryRoot,
      projectRoot,
      sourceRel,
      targetRel,
      options.protectedGlobs ?? [],
      { managedHashes, persistManagedHashes: false },
    );
    recordOutcome(stats, targetRel, outcome);
  }
  await saveManagedHashLedger(projectRoot, managedHashes);
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
  const managedHashes = await loadManagedHashLedger(projectRoot);
  const copyOpts = { managedHashes, persistManagedHashes: false as const };

  for (const member of packManifest.members) {
    const pairs =
      member.kind === "skill"
        ? await skillFileTargets(registryRoot, member.source, member.id)
        : [targetForMember(member)];
    for (const { sourceRel, targetRel } of pairs) {
      const outcome = await copyRegistryFile(
        registryRoot,
        projectRoot,
        sourceRel,
        targetRel,
        protectedGlobs,
        copyOpts,
      );
      recordOutcome(stats, targetRel, outcome);
    }
  }
  await saveManagedHashLedger(projectRoot, managedHashes);
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
