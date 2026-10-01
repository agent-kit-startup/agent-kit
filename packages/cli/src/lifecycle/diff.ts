import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentKitManifest } from "../manifest/types.js";
import { resolveContained } from "./paths.js";
import { isProtectedPath, resolveProtectedGlobs } from "./protected.js";
import { managedPairs } from "./targets.js";

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

  const { pairs, missingSkills } = await managedPairs(registryRoot, manifest);
  for (const { sourceRel, targetRel } of pairs) {
    await pushUnique(sourceRel, targetRel);
  }
  for (const id of missingSkills) {
    entries.push({ path: `skill:${id}`, status: "missing-registry" });
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
