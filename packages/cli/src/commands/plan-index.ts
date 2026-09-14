import path from "node:path";
import { defineCommand } from "citty";
import { formatPlanIndexLines, writePlanIndex } from "../plan-index/plan-index.js";

export const planIndexCommand = defineCommand({
  meta: {
    name: "plan-index",
    description: "Write pending-only plan index from HANDOFF-named plans (no directory glob).",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    json: {
      type: "boolean",
      default: false,
      description: "Print the index JSON after writing",
    },
  },
  async run({ args }) {
    const root = path.resolve(args.cwd);
    const index = await writePlanIndex(root);
    if (args.json) {
      console.log(JSON.stringify(index, null, 2));
      return;
    }
    const lines = formatPlanIndexLines(index);
    if (lines.length === 0) {
      console.log("No pending plans in the HANDOFF-named set.");
      return;
    }
    for (const line of lines) console.log(line);
  },
});
