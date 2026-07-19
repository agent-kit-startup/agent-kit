import path from "node:path";
import { defineCommand } from "citty";
import type { AgentBackend } from "../plan-loop/backends.js";
import { getBackend, listBackendIds } from "../plan-loop/backends.js";
import { runPlanLoop } from "../plan-loop/run-loop.js";
import { logger } from "../utils/logger.js";

export const runPlanCommand = defineCommand({
  meta: {
    name: "run-plan",
    description:
      "Headless continuous plan runner: one fresh agent per tick (LOOP_TICK_RESULT contract). Never git-prod.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Project root (default: current directory)",
      default: process.cwd(),
    },
    "max-ticks": {
      type: "string",
      description: "Maximum ticks before stopping (default: 10)",
      default: "10",
    },
    model: {
      type: "string",
      description: "Optional model id passed to the agent backend",
      default: "",
    },
    sleep: {
      type: "string",
      description: "Seconds to sleep between ticks (default: 5)",
      default: "5",
    },
    backend: {
      type: "string",
      description: `Agent backend (${listBackendIds().join(" | ")}; default: cursor-agent)`,
      default: "cursor-agent",
    },
    "dry-run": {
      type: "boolean",
      description: "Print the tick prompt and exit without starting an agent",
      default: false,
    },
  },
  async run({ args }) {
    const maxTicks = Number.parseInt(String(args["max-ticks"]), 10);
    const sleepSeconds = Number.parseFloat(String(args.sleep));
    if (!Number.isFinite(maxTicks) || maxTicks < 1) {
      logger.error("--max-ticks must be a positive integer");
      process.exitCode = 1;
      return;
    }
    if (!Number.isFinite(sleepSeconds) || sleepSeconds < 0) {
      logger.error("--sleep must be a non-negative number");
      process.exitCode = 1;
      return;
    }

    let backend: AgentBackend;
    try {
      backend = getBackend(String(args.backend));
    } catch (err) {
      logger.error(String(err));
      process.exitCode = 1;
      return;
    }

    const code = await runPlanLoop({
      root: path.resolve(args.cwd),
      maxTicks,
      sleepSeconds,
      model: args.model ? String(args.model) : undefined,
      dryRun: Boolean(args["dry-run"]),
      backend,
    });
    process.exitCode = code;
  },
});
