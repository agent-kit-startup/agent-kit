#!/usr/bin/env node
// Fake `cursor-agent` for the HITL relay tests. Takes the prompt as the last
// positional argument, prints cursor-style stream-json (`system.init`,
// `assistant`, `result`) and exits; it never reads stdin, which is exactly
// the capability gap the relay records as an honest stop. Not a real agent.
// Scenario via FAKE_CURSOR_AGENT_MODE: gate (default) | nogate.

const mode = process.env.FAKE_CURSOR_AGENT_MODE ?? "gate";
const session = "11111111-2222-3333-4444-555555555555";
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const GATE = "Pick one.\n\nHITL_GATE: demo | Alpha | Beta\n1. Alpha\n2. Beta\n";
const body = mode === "nogate" ? "Done.\n\nLOOP_TICK_RESULT: continue" : GATE;

out({ type: "system", subtype: "init", session_id: session, model: "fake" });
out({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text: body }] },
  session_id: session,
});
out({
  type: "result",
  subtype: "success",
  duration_ms: 5,
  duration_api_ms: 4,
  is_error: false,
  result: body,
  session_id: session,
  request_id: "req-fake",
});
