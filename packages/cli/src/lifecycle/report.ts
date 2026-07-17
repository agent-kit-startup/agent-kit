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
  if (stats.skippedProtected.length > 0) {
    logger.warn(`Skipped protected (L3): ${stats.skippedProtected.length}`);
    for (const p of stats.skippedProtected) logger.info(`  ~ ${p}`);
  }
  if (stats.missing.length > 0) {
    logger.warn(`Missing in registry: ${stats.missing.length}`);
    for (const p of stats.missing) logger.info(`  ? ${p}`);
  }
}
