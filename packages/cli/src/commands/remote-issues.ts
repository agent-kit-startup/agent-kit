import { defineCommand } from "citty";
import { readRemoteIssues } from "../lifecycle/remote-issues.js";
import { logger } from "../utils/logger.js";

export const remoteIssuesCommand = defineCommand({
  meta: {
    name: "remote-issues",
    description:
      "Read-only: list remote dogfood issues (provenance label or [Dogfood] title) for the current lane, GitHub or GitLab (JSON).",
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
  },
  async run({ args }) {
    const result = await readRemoteIssues(args.cwd);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    logger.info(`[${result.lane}] ${result.items.length} remote dogfood issue(s)`);
    for (const item of result.items) {
      logger.info(`- ${item.cite}: ${item.title} (${item.url})`);
    }
    for (const note of result.notes) logger.warn(note.message);
  },
});
