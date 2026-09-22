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
// Every turn after the scripted ones answers `received: <text>`.
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

function firstTurnBody() {
  switch (mode) {
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

function handleTurn(text) {
  turn += 1;
  init();
  let body;
  if (turn === 1) body = firstTurnBody();
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
