import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentKitManifest } from "../manifest/types.js";
import { allSkills, loadRegistry } from "../registry/client.js";
import { loadPackManifest, packMemberTargets } from "../registry/install.js";
import { L0_ARTIFACTS } from "./l0.js";
import { resolveContained } from "./paths.js";
import { isProtectedPath, resolveProtectedGlobs } from "./protected.js";

export type DiffStatus = "match" | "drift" | "missing-local" | "missing-registry" | "protected";

export interface DiffEntry {
  path: string;
  status: DiffStatus;
}

async function readIfExists(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

async function comparePair(
  registryRoot: string,
  projectRoot: string,
  sourceRel: string,
  targetRel: string,
  protectedGlobs: readonly string[],
): Promise<DiffEntry> {
  const posixTarget = targetRel.split(path.sep).join("/");
  if (isProtectedPath(posixTarget, protectedGlobs)) {
    return { path: posixTarget, status: "protected" };
  }

  let sourceAbs: string;
  try {
    sourceAbs = resolveContained(registryRoot, sourceRel);
  } catch {
    return { path: posixTarget, status: "missing-registry" };
  }

  const registryContent = await readIfExists(sourceAbs);
  if (registryContent === null) {
    return { path: posixTarget, status: "missing-registry" };
  }

  let targetAbs: string;
  try {
    targetAbs = resolveContained(projectRoot, targetRel);
  } catch {
    return { path: posixTarget, status: "missing-local" };
  }

  const localContent = await readIfExists(targetAbs);
  if (localContent === null) return { path: posixTarget, status: "missing-local" };
  if (localContent === registryContent) return { path: posixTarget, status: "match" };
  return { path: posixTarget, status: "drift" };
}

/** Diff installed kit artifacts vs registry (L0 + packs + skills from manifest). */
export async function diffAgainstRegistry(
  registryRoot: string,
  projectRoot: string,
  manifest: AgentKitManifest,
): Promise<DiffEntry[]> {
  const protectedGlobs = resolveProtectedGlobs(manifest);
  const entries: DiffEntry[] = [];
  const seen = new Set<string>();

  const pushUnique = async (sourceRel: string, targetRel: string) => {
    const key = targetRel.split(path.sep).join("/");
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(
      await comparePair(registryRoot, projectRoot, sourceRel, targetRel, protectedGlobs),
    );
  };

  for (const a of L0_ARTIFACTS) {
    await pushUnique(a.source, a.target);
  }

  for (const packId of manifest.packs ?? []) {
    const pack = await loadPackManifest(registryRoot, packId);
    for (const member of pack.members) {
      const { sourceRel, targetRel } = packMemberTargets(member);
      await pushUnique(sourceRel, targetRel);
    }
  }

  if ((manifest.skills ?? []).length > 0) {
    const index = await loadRegistry(registryRoot);
    const pool = allSkills(index);
    for (const id of manifest.skills ?? []) {
      const skill = pool.find((s) => s.id === id);
      if (!skill) {
        entries.push({ path: `skill:${id}`, status: "missing-registry" });
        continue;
      }
      const category = skill.path.includes("/core/") ? "core" : "community";
      const sourceRel = path.posix.join(skill.path, "SKILL.md");
      const targetRel = path.posix.join(".cursor", "skills", category, skill.id, "SKILL.md");
      await pushUnique(sourceRel, targetRel);
    }
  }

  return entries;
}

export function summarizeDiff(entries: DiffEntry[]): Record<DiffStatus, number> {
  const summary: Record<DiffStatus, number> = {
    match: 0,
    drift: 0,
    "missing-local": 0,
    "missing-registry": 0,
    protected: 0,
  };
  for (const e of entries) summary[e.status] += 1;
  return summary;
}
