import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentKitManifest } from "../manifest/types.js";
import {
  DEFAULT_PROTECTED_PATHS,
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA_VERSION,
} from "../manifest/types.js";
import { writeJson } from "../utils/fs.js";
import { resolveContained, toPosixRel } from "./paths.js";
import { isProtectedPath, normalizeProtectedGlobs, resolveProtectedGlobs } from "./protected.js";

export type CopyOutcome = "written" | "skipped-protected" | "missing-source" | "unchanged";

export interface ApplyStats {
  written: string[];
  skippedProtected: string[];
  missing: string[];
  unchanged: string[];
}

export function emptyStats(): ApplyStats {
  return { written: [], skippedProtected: [], missing: [], unchanged: [] };
}

export function mergeStats(into: ApplyStats, from: ApplyStats): ApplyStats {
  into.written.push(...from.written);
  into.skippedProtected.push(...from.skippedProtected);
  into.missing.push(...from.missing);
  into.unchanged.push(...from.unchanged);
  return into;
}

/**
 * Copy a file from registry root → project root, skipping L3 protected paths.
 */
export async function copyRegistryFile(
  registryRoot: string,
  projectRoot: string,
  sourceRel: string,
  targetRel: string,
  protectedGlobs: readonly string[],
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
  if (existing === next) return "unchanged";

  await mkdir(path.dirname(targetAbs), { recursive: true });
  await copyFile(sourceAbs, targetAbs);
  return "written";
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
    installedAt: new Date().toISOString(),
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
