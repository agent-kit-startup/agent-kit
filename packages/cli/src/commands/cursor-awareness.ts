import { defineCommand } from "citty";
import { checkCursorUpdateAwareness } from "../lifecycle/cursor-update-awareness.js";
import { logger } from "../utils/logger.js";

export const cursorAwarenessCommand = defineCommand({
  meta: {
    name: "cursor-awareness",
    description: "Opt-in advisory: Cursor changelog vs native-audit gaps (never apply).",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    check: {
      type: "boolean",
      description: "Check-only (default true; apply is never supported)",
      default: true,
    },
    json: {
      type: "boolean",
      description: "Print machine-readable JSON",
      default: false,
    },
    "respect-prefs": {
      type: "boolean",
      description:
        "Honor cursorUpdateCheck.enabled and intervalDays from .cursor/context/config.json",
      default: false,
    },
    stamp: {
      type: "boolean",
      description: "Persist cursorUpdateCheck.lastCheckedAt / lastSeenCursorVersion",
      default: false,
    },
    offline: {
      type: "boolean",
      description: "Skip changelog network fetch; inventory-only advisory",
      default: false,
    },
  },
  async run({ args }) {
    // Apply is never supported; --check is informational only.
    void args.check;

    const result = await checkCursorUpdateAwareness(args.cwd, {
      respectPrefs: Boolean(args["respect-prefs"]),
      stamp: Boolean(args.stamp),
      offline: Boolean(args.offline),
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const line = `[${result.status}] ${result.message}`;
      if (result.status === "error") logger.error(line);
      else if (result.status === "gaps-found") logger.warn(line);
      else if (result.status.startsWith("skipped-")) logger.warn(line);
      else logger.info(line);
      if (result.gaps.length > 0 && !args.json) {
        for (const gap of result.gaps.slice(0, 12)) {
          logger.info(`- ${gap.id} (${gap.severity}): ${gap.evidence} → ${gap.suggestedRoute}`);
        }
        if (result.gaps.length > 12) {
          logger.info(`… and ${result.gaps.length - 12} more (use --json)`);
        }
      }
    }

    if (result.status === "error") process.exitCode = 2;
  },
});
