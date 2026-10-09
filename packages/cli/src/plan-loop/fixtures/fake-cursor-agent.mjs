#!/usr/bin/env node
// Fake `cursor-agent` for the HITL relay tests. Takes the prompt as the last
// positional argument, prints cursor-style stream-json (`system.init`,
// `assistant`, `result`) and exits; it never reads stdin, which is exactly
// the capability gap the relay records as an honest stop. Not a real agent.
// Scenario via FAKE_CURSOR_AGENT_MODE: gate (default) | nogate | echo-env
// (prints every vendor secret it inherited, raw and encoded, on stdout and
// stderr: the seeded-environment redaction test).

const mode = process.env.FAKE_CURSOR_AGENT_MODE ?? "gate";
const session = "11111111-2222-3333-4444-555555555555";
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const GATE = "Pick one.\n\nHITL_GATE: demo | Alpha | Beta\n1. Alpha\n2. Beta\n";
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
const body =
  mode === "nogate"
    ? "Done.\n\nLOOP_TICK_RESULT: continue"
    : mode === "echo-env"
      ? `${envDump()}\n\nLOOP_TICK_RESULT: continue`
      : GATE;
if (mode === "echo-env") process.stderr.write(`${envDump()}\n`);

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
