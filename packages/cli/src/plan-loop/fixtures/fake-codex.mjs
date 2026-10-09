#!/usr/bin/env node
// Fake `codex` for the codex backend tests. Speaks the `codex exec --json`
// JSONL shape the backend translates (`thread.started`, `turn.started`,
// `item.started` / `item.completed`, `turn.completed`, `turn.failed`), reads
// the prompt from stdin (`-`), and supports `exec resume <thread_id> -`.
// Not a real agent; no network. Scenario via FAKE_CODEX_MODE:
//   gate (default)  first turn ends at `HITL_GATE: demo | Alpha | Beta`; a
//                   resumed turn answers `received: <prompt>` + LOOP_TICK_RESULT
//   tick            first turn ends with `LOOP_TICK_RESULT: continue`
//   limit           the turn fails with a usage-limit error
//   auth            reports whether CODEX_API_KEY reached it (never the value)
//   driver-plan     one run-plan tick on FAKE_CODEX_PLAN (same rules as fake-claude)
// FAKE_CODEX_TRACE=<file> appends one JSON line per run: argv and stdin.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\n");
  process.exit(0);
}
const mode = process.env.FAKE_CODEX_MODE ?? "gate";
const resume = args[0] === "exec" && args[1] === "resume";
const threadId = resume ? args[args.length - 2] : "0199a000-fake-4000-8000-codexthread01";
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const GATE = "Pick one.\n\nHITL_GATE: demo | Alpha | Beta\n1. Alpha\n2. Beta\n";
const DRIVER_GATE =
  "Gate before this to-do.\n\nHITL_GATE: driver-demo | Proceed | Hold\n1. Proceed\n2. Hold\n";

function completeNextTodo(prefix) {
  const planPath = process.env.FAKE_CODEX_PLAN ?? "";
  const next = readFileSync(planPath, "utf8").replace("status: pending", "status: completed");
  writeFileSync(planPath, next);
  const left = (next.match(/status: pending/g) ?? []).length;
  const sentinel =
    left > 0 ? "LOOP_TICK_RESULT: continue" : "LOOP_TICK_RESULT: stop - plan exhausted";
  return `${prefix}To-do completed (${left} pending).\n\n${sentinel}`;
}

function body(prompt) {
  switch (mode) {
    case "tick":
      return "Tick done.\n\nLOOP_TICK_RESULT: continue";
    case "auth":
      return `CODEX_API_KEY ${process.env.CODEX_API_KEY ? "set" : "unset"}\n\nLOOP_TICK_RESULT: continue`;
    case "driver-plan": {
      const plan = readFileSync(process.env.FAKE_CODEX_PLAN ?? "", "utf8");
      const done = (plan.match(/status: completed/g) ?? []).length;
      if (!resume && done === 1) return DRIVER_GATE;
      return completeNextTodo(resume ? `received: ${prompt.trim()}\n` : "");
    }
    default:
      return resume ? `received: ${prompt.trim()}\n\nLOOP_TICK_RESULT: continue` : GATE;
  }
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  if (process.env.FAKE_CODEX_TRACE) {
    appendFileSync(process.env.FAKE_CODEX_TRACE, `${JSON.stringify({ args, stdin })}\n`);
  }
  out({ type: "thread.started", thread_id: threadId });
  out({ type: "turn.started" });
  if (mode === "limit") {
    out({
      type: "turn.failed",
      error: { message: "You've hit your usage limit. Upgrade or try again later." },
    });
    return;
  }
  out({
    type: "item.started",
    item: {
      id: "item_0",
      type: "command_execution",
      command: "bash -lc ls",
      status: "in_progress",
    },
  });
  out({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "command_execution",
      command: "bash -lc ls",
      aggregated_output: "README.md\n",
      exit_code: 0,
      status: "completed",
    },
  });
  out({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: body(stdin) } });
  out({
    type: "turn.completed",
    usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
  });
});
