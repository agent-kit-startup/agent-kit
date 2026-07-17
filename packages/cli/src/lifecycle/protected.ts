import { type AgentKitManifest, DEFAULT_PROTECTED_PATHS } from "../manifest/types.js";
import { matchesAnyGlob, normalizeRelPath } from "./glob.js";

/** Globs that `update` / install must never overwrite. */
export function resolveProtectedGlobs(manifest: AgentKitManifest | null | undefined): string[] {
  const fromManifest = manifest?.protected ?? [];
  const overrides = (manifest?.overrides ?? []).map((o) => o.path);
  const merged = [...DEFAULT_PROTECTED_PATHS, ...fromManifest, ...overrides];
  return [...new Set(merged.map(normalizeRelPath))];
}

export function isProtectedPath(relPath: string, globs: readonly string[]): boolean {
  return matchesAnyGlob(relPath, globs);
}
