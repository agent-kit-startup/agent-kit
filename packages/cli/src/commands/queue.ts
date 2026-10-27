import path from "node:path";
import { defineCommand } from "citty";
import { readHandoffText } from "../plan-loop/dispatch-driver.js";
import {
  decideQueueEndGatesAsk,
  formatQueueEndResolutionPrompt,
  type QueueEndGatesDecision,
  readDeferredGatesFromHandoff,
} from "../plan-loop/run-plan-all-orchestrator.js";

export type QueueGatesFormat = "text" | "json" | "prompt";

/**
 * Deferred operator gates of the last `/run-plan-all` queue, read from the
 * HANDOFF `Queue outcomes` rows with zero inference (ADR 2026-10-26 driver
 * chat, point 3). Read-only: never answers a gate, never edits HANDOFF.
 */
export function renderQueueGates(
  handoff: string,
  format: QueueGatesFormat,
  backend = "claude",
): string {
  const decision: QueueEndGatesDecision = decideQueueEndGatesAsk(
    readDeferredGatesFromHandoff(handoff),
  );
  if (format === "json") return `${JSON.stringify(decision, null, 2)}\n`;
  if (format === "prompt") {
    return decision.ask ? formatQueueEndResolutionPrompt(decision.gates, backend) : "";
  }
  if (!decision.ask) return "No deferred operator gates in HANDOFF Queue outcomes.\n";
  const lines = [`Deferred operator gates (${decision.gates.length}):`];
  for (const g of decision.gates) {
    lines.push(`- ${g.plan}: ${g.gate}`);
    if (g.asks.length) lines.push(`  open Asks: ${g.asks.join(", ")}`);
  }
  lines.push(
    "",
    "Relaunch with the resolution prompt: agent-kit queue gates --prompt > note.md && agent-kit run-plan-all --note @note.md",
  );
  return `${lines.join("\n")}\n`;
}

const gatesCommand = defineCommand({
  meta: {
    name: "gates",
    description:
      "Print the deferred operator gates from HANDOFF Queue outcomes (zero inference); --prompt prints the relaunch command and resolution prompt",
  },
  args: {
    json: { type: "boolean", description: "Print the gates decision as JSON", default: false },
    prompt: {
      type: "boolean",
      description:
        "Print the relaunch command and resolution prompt (input for `run-plan-all --note @file`); empty when no gate is deferred",
      default: false,
    },
    backend: {
      type: "string",
      description: "Backend named in the --prompt command line (default: claude)",
      default: "claude",
    },
    cwd: { type: "string", description: "Workspace folder (default: current directory)" },
  },
  async run({ args }) {
    if (args.json && args.prompt) {
      process.stderr.write("Use either --json or --prompt, not both.\n");
      process.exitCode = 1;
      return;
    }
    const root = path.resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
    const handoff = (await readHandoffText(root)) ?? "";
    const format: QueueGatesFormat = args.json ? "json" : args.prompt ? "prompt" : "text";
    process.stdout.write(renderQueueGates(handoff, format, String(args.backend || "claude")));
  },
});

export const queueCommand = defineCommand({
  meta: {
    name: "queue",
    description: "Read the /run-plan-all queue from HANDOFF (`gates`: deferred operator gates)",
  },
  subCommands: { gates: gatesCommand },
});
