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
  if (stats.missing.length > 0) {
    logger.warn(`Missing in registry: ${stats.missing.length}`);
    for (const p of stats.missing) logger.info(`  ? ${p}`);
  }
}
