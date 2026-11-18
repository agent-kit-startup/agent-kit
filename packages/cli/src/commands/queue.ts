import path from "node:path";
import { defineCommand } from "citty";
import { readHandoffText } from "../plan-loop/dispatch-driver.js";
import {
  formatQueueLeaseRefusal,
  inspectQueueLease,
  QUEUE_LEASE_RELPATH,
  type QueueLeaseVerdict,
} from "../plan-loop/queue-lease.js";
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

/**
 * Read-only queue owner lease check (ADR 2026-07-26 Amend 2026-11-16): exit 0
 * when the queue is free, stale or held by the caller's own session
 * (`AGENT_KIT_QUEUE_LEASE_SESSION`), exit 1 when another live owner holds it.
 * An orchestrator runs it before writing Queue fields; an interactive
 * /run-plan-all runs it before dispatching. Never writes the lease.
 */
export function renderQueueLease(
  verdict: QueueLeaseVerdict,
  json: boolean,
): { text: string; exitCode: number } {
  const exitCode = verdict.kind === "held" ? 1 : 0;
  if (json) return { text: `${JSON.stringify(verdict, null, 2)}\n`, exitCode };
  switch (verdict.kind) {
    case "free":
      return { text: `Queue lease: free (no ${QUEUE_LEASE_RELPATH}).\n`, exitCode };
    case "own":
      return { text: `Queue lease: held by this session (${verdict.lease.session}).\n`, exitCode };
    case "stale":
      return {
        text: `Queue lease: stale (${verdict.reason}); the next run-plan-all takes it over and logs it in HANDOFF.\n`,
        exitCode,
      };
    case "held":
      return { text: `${formatQueueLeaseRefusal(verdict)}\n`, exitCode };
  }
}

const leaseCommand = defineCommand({
  meta: {
    name: "lease",
    description:
      "Check the /run-plan-all queue owner lease (read-only): exit 0 free, stale or own session; exit 1 held by another live owner",
  },
  args: {
    json: { type: "boolean", description: "Print the lease verdict as JSON", default: false },
    cwd: { type: "string", description: "Workspace folder (default: current directory)" },
  },
  run({ args }) {
    const root = path.resolve(typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
    const out = renderQueueLease(inspectQueueLease(root), Boolean(args.json));
    process.stdout.write(out.text);
    process.exitCode = out.exitCode;
  },
});

export const queueCommand = defineCommand({
  meta: {
    name: "queue",
    description:
      "Read the /run-plan-all queue (`gates`: deferred operator gates from HANDOFF; `lease`: the queue owner lease)",
  },
  subCommands: { gates: gatesCommand, lease: leaseCommand },
});
