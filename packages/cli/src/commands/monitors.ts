import path from "node:path";
import { defineCommand } from "citty";
import { selectUntriagedMonitors } from "../invariants/monitors-untriaged.js";

export const monitorsCommand = defineCommand({
  meta: {
    name: "monitors",
    description: "Plan-monitor selection helpers (untriaged SoT for /plan-review-triage)",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    untriaged: {
      type: "boolean",
      default: false,
      description: "Select untriaged monitors (never newest-mtime-wins alone)",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Machine-readable JSON",
    },
  },
  async run({ args }) {
    if (!args.untriaged) {
      console.error("Usage: agent-kit monitors --untriaged [--json] [--cwd <dir>]");
      process.exitCode = 2;
      return;
    }
    const result = await selectUntriagedMonitors(path.resolve(args.cwd));
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.monitors.length === 0) {
      console.log("No untriaged plan-monitor files.");
      return;
    }
    for (const m of result.monitors) {
      console.log(m.relativePath);
    }
  },
});
