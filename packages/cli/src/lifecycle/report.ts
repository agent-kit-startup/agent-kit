import { logger } from "../utils/logger.js";
import type { ApplyStats } from "./apply.js";

/** Print apply outcomes for CLI commands. */
export function logApplyStats(stats: ApplyStats): void {
  if (stats.written.length > 0) {
    logger.success(`Wrote ${stats.written.length} file(s)`);
    for (const p of stats.written) logger.info(`  + ${p}`);
  }
  if (stats.unchanged.length > 0) {
    logger.info(`Unchanged: ${stats.unchanged.length}`);
  }
  if (stats.removed.length > 0) {
    logger.info(`Removed managed legacy files: ${stats.removed.length}`);
    for (const p of stats.removed) logger.info(`  - ${p}`);
  }
  if (stats.collisions.length > 0) {
    logger.warn("Slash collision preserved because the legacy command is customized:");
    for (const p of stats.collisions) logger.info(`  ! ${p}`);
  }
  if (stats.preservedCustomized.length > 0) {
    logger.warn(
      `Preserved customized overlay (agents/skills/commands/hooks/scripts); local body kept, kit body not applied: ${stats.preservedCustomized.length}`,
    );
    for (const p of stats.preservedCustomized) logger.info(`  ! ${p}`);
    logger.info(
      "  Run `agent-kit diff` to see the kit body; send the change upstream (`agent-kit contribute` for agents/skills/commands/hooks, a factory PR for scripts); or add the path to `protected` in .cursor/agent-kit.json to keep it pinned on purpose.",
    );
  }
  if (stats.skippedProtected.length > 0) {
    logger.warn(`Skipped protected (L3): ${stats.skippedProtected.length}`);
    for (const p of stats.skippedProtected) logger.info(`  ~ ${p}`);
  }
  if (stats.skippedSymlink.length > 0) {
    logger.warn(
      `Skipped symlinked path (resolves outside the registry/project root, or is a symlink): ${stats.skippedSymlink.length}`,
    );
    for (const p of stats.skippedSymlink) logger.info(`  ~ ${p}`);
  }
  if (stats.missing.length > 0) {
    logger.warn(`Missing in registry: ${stats.missing.length}`);
    for (const p of stats.missing) logger.info(`  ? ${p}`);
  }
}

function listSkippedPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 5).join(", ");
  const more = paths.length > 5 ? ` (+${paths.length - 5} more)` : "";
  return `${shown}${more}`;
}

/**
 * One error line for paths apply skipped because they resolve outside the
 * project (e.g. a consumer's .cursor symlinked to a shared dir). Callers must
 * not record a new kit version when this is non-empty: the content did not land.
 */
export function formatSkippedSymlinks(paths: readonly string[]): string {
  return `${paths.length} kit path(s) were not written because they resolve outside the project (symlink): ${listSkippedPaths(paths)}. Manifest version left unchanged; replace the symlinked directory with a real one inside the project and re-run.`;
}

/**
 * Install variant for personalization skips: L0 landed and the manifest was
 * saved without the skipped skill/pack ids, so name those instead.
 */
export function formatPersonalizationSkippedSymlinks(
  paths: readonly string[],
  notRecorded: readonly string[],
): string {
  const ids = notRecorded.length > 0 ? notRecorded.join(", ") : "none";
  return `${paths.length} personalization path(s) were not written because they resolve outside the project (symlink): ${listSkippedPaths(paths)}. Manifest saved without: ${ids}; replace the symlinked directory with a real one inside the project and re-run.`;
}

/** Thrown by performInstall when apply skipped symlinked paths; carries stats for reporting. */
export class SkippedSymlinkError extends Error {
  constructor(
    readonly stats: ApplyStats,
    message: string = formatSkippedSymlinks(stats.skippedSymlink),
    /** Copy-paste SessionStart hook JSON when it could not be merged before the failure. */
    readonly claudeSessionStartInstructions?: string,
  ) {
    super(message);
    this.name = "SkippedSymlinkError";
  }
}
