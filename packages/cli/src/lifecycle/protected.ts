import {
  type AgentKitManifest,
  DEFAULT_PROTECTED_PATHS,
  LEGACY_CONTEXT_PROTECTED_GLOB,
} from "../manifest/types.js";
import { matchesAnyGlob, normalizeRelPath } from "./glob.js";

/** Session-only context paths (kit templates / config.example stay installable). */
const CONTEXT_SESSION_GLOBS: readonly string[] = [
  ".cursor/context/config.json",
  ".cursor/context/current/**",
  ".cursor/context/backups/**",
];

/**
 * Expand legacy `.cursor/context/**` into session-only globs so L0 can ship
 * `.cursor/context/templates/**` and `config.example.json`.
 */
export function normalizeProtectedGlobs(globs: readonly string[]): string[] {
  const out: string[] = [];
  let sawLegacyContext = false;
  for (const raw of globs) {
    const g = normalizeRelPath(raw);
    if (g === LEGACY_CONTEXT_PROTECTED_GLOB) {
      sawLegacyContext = true;
      continue;
    }
    out.push(g);
  }
  if (sawLegacyContext) {
    out.push(...CONTEXT_SESSION_GLOBS);
  }
  return [...new Set(out)];
}

/** Globs that `update` / install must never overwrite. */
export function resolveProtectedGlobs(manifest: AgentKitManifest | null | undefined): string[] {
  const fromManifest = manifest?.protected ?? [];
  const overrides = (manifest?.overrides ?? []).map((o) => o.path);
  const merged = [...DEFAULT_PROTECTED_PATHS, ...fromManifest, ...overrides];
  return normalizeProtectedGlobs(merged);
}

export function isProtectedPath(relPath: string, globs: readonly string[]): boolean {
  return matchesAnyGlob(relPath, globs);
}
