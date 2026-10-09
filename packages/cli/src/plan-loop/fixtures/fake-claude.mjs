#!/usr/bin/env node
// Fake `claude` for the HITL relay tests. Speaks the stream-json protocol the
// relay depends on: reads `user` events from stdin (`--input-format
// stream-json`), echoes them with `isReplay: true` (`--replay-user-messages`),
// prints one `assistant` and one `result` event per turn, and exits when stdin
// ends. Not a real agent; no network. Scenario via FAKE_CLAUDE_MODE:
//   gate (default)   turn 1 ends at `HITL_GATE: demo | Alpha | Beta`
//   two-gates        turn 1 as `gate`, turn 2 at `HITL_GATE: second | Gamma | Delta`
//   fallback         turn 1 is a numbered list with the prose wording, no sentinel
//   reserved         turn 1 ends at `HITL_GATE: git-prod | ...`
//   nogate           turn 1 is a plain result (idles until stdin ends)
//   tick             turn 1 ends with `LOOP_TICK_RESULT: continue`
//   ignore-stdin-end like `gate`, but never exits on stdin end (kill path)
//   echo-env         turn 1 prints every vendor secret it inherited, raw and
//                    encoded, in assistant/result text and on stderr (redaction test)
//   limit            turn 1 hits a usage limit: `rate_limit_event` status
//                    `rejected`, then an error `result` naming the limit
//   driver-plan      plays one tick of `run-plan` on the plan at FAKE_CLAUDE_PLAN:
//                    flips the first `status: pending` to `completed` and ends
//                    with LOOP_TICK_RESULT; the tick that finds exactly one
//                    to-do already completed first ends at
//                    `HITL_GATE: driver-demo | Proceed | Hold` and completes
//                    only after the reply (driver-mode end-to-end test)
// Every turn after the scripted ones answers `received: <text>`.
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "gate";
const replay = args.includes("--replay-user-messages");
const inputIdx = args.indexOf("--input-format");
const streamIn = inputIdx !== -1 && args[inputIdx + 1] === "stream-json";
const session = "fake-claude-session-0001";
let turn = 0;

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const init = () => out({ type: "system", subtype: "init", session_id: session, model: "fake" });
const assistant = (text) =>
  out({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    session_id: session,
  });
const result = (text) =>
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: session,
    num_turns: turn,
    duration_ms: 5,
    total_cost_usd: 0.001,
  });

const GATE = "Pick one.\n\nHITL_GATE: demo | Alpha | Beta\n1. Alpha\n2. Beta\n";
const SECOND = "Next.\n\nHITL_GATE: second | Gamma | Delta\n1. Gamma\n2. Delta\n";
const FALLBACK =
  "Ask questions is not available in this session. Reply with the number or the label. You can also type your own answer (Other).\n\n1. Alpha\n2. Beta\n";
const RESERVED =
  "HITL_GATE: git-prod | Proceed with production deploy | Review changes first | Cancel\n1. Proceed with production deploy\n2. Review changes first\n3. Cancel\n";

const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CURSOR_API_KEY",
  "CURSOR_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
];
function envDump() {
  return SECRET_KEYS.filter((k) => process.env[k])
    .map((k) => {
      const v = process.env[k];
      return `${k}=${v} b64=${Buffer.from(v).toString("base64")} url=${encodeURIComponent(v)}`;
    })
    .join("\n");
}

function firstTurnBody() {
  switch (mode) {
    case "echo-env":
      process.stderr.write(`${envDump()}\n`);
      return `${envDump()}\n\nLOOP_TICK_RESULT: continue`;
    case "nogate":
      return "Done. Nothing to ask.";
    case "tick":
      return "Tick done.\n\nLOOP_TICK_RESULT: continue";
    case "fallback":
      return FALLBACK;
    case "reserved":
      return RESERVED;
    default:
      return GATE;
  }
}

const DRIVER_GATE =
  "Gate before this to-do.\n\nHITL_GATE: driver-demo | Proceed | Hold\n1. Proceed\n2. Hold\n";

/** One `run-plan` tick on FAKE_CLAUDE_PLAN: complete the next pending to-do. */
function completeNextTodo(prefix) {
  const planPath = process.env.FAKE_CLAUDE_PLAN ?? "";
  const plan = readFileSync(planPath, "utf8");
  const next = plan.replace("status: pending", "status: completed");
  writeFileSync(planPath, next);
  const left = (next.match(/status: pending/g) ?? []).length;
  const sentinel =
    left > 0 ? "LOOP_TICK_RESULT: continue" : "LOOP_TICK_RESULT: stop - plan exhausted";
  return `${prefix}To-do completed (${left} pending).\n\n${sentinel}`;
}

function driverPlanBody(text) {
  const plan = readFileSync(process.env.FAKE_CLAUDE_PLAN ?? "", "utf8");
  const done = (plan.match(/status: completed/g) ?? []).length;
  if (turn === 1 && done === 1) return DRIVER_GATE;
  return completeNextTodo(turn > 1 ? `received: ${text}\n` : "");
}

function handleTurn(text) {
  turn += 1;
  init();
  if (mode === "limit") {
    out({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1791500000 },
      session_id: session,
    });
    out({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Claude AI usage limit reached|1791500000",
      session_id: session,
      num_turns: turn,
    });
    return;
  }
  let body;
  if (mode === "driver-plan") body = driverPlanBody(text);
  else if (turn === 1) body = firstTurnBody();
  else if (mode === "two-gates" && turn === 2) body = SECOND;
  else body = `received: ${text}`;
  assistant(body);
  result(body);
}

function textOf(event) {
  const content = event?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return "";
}

// stdout is a pipe: let the process drain and exit on its own (no process.exit).
if (!streamIn) {
  handleTurn(args[args.length - 1] ?? "");
} else {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event?.type !== "user") return;
    if (replay) out({ ...event, isReplay: true, session_id: session });
    handleTurn(textOf(event));
  });
  rl.on("close", () => {
    if (mode === "ignore-stdin-end") setInterval(() => {}, 1000);
  });
}
