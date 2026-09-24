import { defineCommand } from "citty";
import { checkPublicInbound } from "../lifecycle/public-inbound-radar.js";
import { logger } from "../utils/logger.js";

export const publicInboundRadarCommand = defineCommand({
  meta: {
    name: "public-inbound-radar",
    description:
      "Factory-only: list open public issues/PRs on agent-kit-startup/agent-kit (read-only JSON).",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    json: {
      type: "boolean",
      description: "Print machine-readable JSON (default true for scripting)",
      default: true,
    },
    offline: {
      type: "boolean",
      description: "Skip GitHub fetch; fail-open skipped-offline",
      default: false,
    },
    "respect-prefs": {
      type: "boolean",
      description:
        "Honor publicInboundCheck.enabled and intervalDays from .cursor/context/config.json",
      default: false,
    },
    stamp: {
      type: "boolean",
      description: "Persist publicInboundCheck.lastCheckedAt after an ok check",
      default: false,
    },
  },
  async run({ args }) {
    const result = await checkPublicInbound(args.cwd, {
      offline: Boolean(args.offline),
      respectPrefs: Boolean(args["respect-prefs"]),
      stamp: Boolean(args.stamp),
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const line = `[${result.status}] ${result.message}`;
      if (result.status === "error") logger.error(line);
      else if (result.status.startsWith("skipped-")) logger.warn(line);
      else logger.info(line);
      for (const item of result.items.slice(0, 20)) {
        logger.info(`- ${item.class} ${item.cite}: ${item.title} (@${item.author})`);
      }
      if (result.items.length > 20) {
        logger.info(`… and ${result.items.length - 20} more (use --json)`);
      }
    }

    if (result.status === "error") process.exitCode = 2;
  },
});
