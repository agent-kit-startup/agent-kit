#!/usr/bin/env node
// Fake `cursor-agent acp` for the cursor-acp backend tests: newline-delimited
// JSON-RPC 2.0 on stdio, as documented at https://cursor.com/docs/cli/acp.
// `initialize` answers with the result recorded from cursor-agent
// 2026.10.01-e373342 (fixtures/cursor-acp-initialize-2026.10.01.json). Not a
// real agent; no network. Scenario via FAKE_CURSOR_ACP_MODE:
//   gate (default)  turn 1 ends at `HITL_GATE: demo | Alpha | Beta` (the
//                   sentinel line split across two chunks); turn 2 answers
//                   `received: <prompt>` + LOOP_TICK_RESULT
//   permission      asks session/request_permission, reports the optionId
//   ask             asks cursor/ask_question (q1: Agent / Plan), reports the answer
//   create-plan     asks cursor/create_plan, reports the JSON-RPC error code
//   auth-fail       `authenticate` fails
//   limit           `session/prompt` fails with a usage-limit error
//   driver-plan     one run-plan tick on FAKE_CURSOR_ACP_PLAN (same rules as fake-claude)
// FAKE_CURSOR_ACP_LINGER=1 keeps running after stdin ends (measured on the
// real binary). FAKE_CURSOR_ACP_TRACE=<file> appends every received line.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_CURSOR_ACP_MODE ?? "gate";
const SESSION = "fake-acp-session-0001";
let turn = 0;
let nextId = 1000;
const waiting = new Map();

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
const chunk = (text) =>
  send({
    method: "session/update",
    params: {
      sessionId: SESSION,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });

function completeNextTodo(prefix) {
  const planPath = process.env.FAKE_CURSOR_ACP_PLAN ?? "";
  const next = readFileSync(planPath, "utf8").replace("status: pending", "status: completed");
  writeFileSync(planPath, next);
  const left = (next.match(/status: pending/g) ?? []).length;
  const sentinel =
    left > 0 ? "LOOP_TICK_RESULT: continue" : "LOOP_TICK_RESULT: stop - plan exhausted";
  return `${prefix}To-do completed (${left} pending).\n\n${sentinel}`;
}

async function prompt(id, text) {
  turn += 1;
  send({
    method: "session/update",
    params: {
      sessionId: SESSION,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: `call_${turn}`,
        title: "Read plan",
        kind: "read",
      },
    },
  });
  if (mode === "limit") {
    send({
      id,
      error: { code: -32000, message: "You've hit your usage limit for this billing cycle." },
    });
    return;
  }
  if (mode === "permission") {
    const res = await ask("session/request_permission", {
      sessionId: SESSION,
      toolCall: { toolCallId: "call_p", title: "Run shell" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow-always", name: "Always allow", kind: "allow_always" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });
    chunk(
      `permission: ${res?.result?.outcome?.optionId ?? res?.result?.outcome?.outcome}\n\nLOOP_TICK_RESULT: continue`,
    );
  } else if (mode === "ask") {
    const res = await ask("cursor/ask_question", {
      toolCallId: "call_123",
      title: "Need input",
      questions: [
        {
          id: "q1",
          prompt: "Which mode should I use?",
          options: [
            { id: "agent", label: "Agent" },
            { id: "plan", label: "Plan" },
          ],
          allowMultiple: false,
        },
      ],
    });
    const outcome = res?.result?.outcome;
    const picked = outcome?.answers?.[0]?.selectedOptionIds?.join(",") ?? outcome?.outcome;
    chunk(`answered: ${picked}\n\nLOOP_TICK_RESULT: continue`);
  } else if (mode === "create-plan") {
    const res = await ask("cursor/create_plan", { toolCallId: "call_124", name: "x", plan: "1." });
    chunk(`create_plan error: ${res?.error?.code}\n\nLOOP_TICK_RESULT: continue`);
  } else if (mode === "driver-plan") {
    const plan = readFileSync(process.env.FAKE_CURSOR_ACP_PLAN ?? "", "utf8");
    const done = (plan.match(/status: completed/g) ?? []).length;
    if (turn === 1 && done === 1) {
      chunk(
        "Gate before this to-do.\n\nHITL_GATE: driver-demo | Proceed | Hold\n1. Proceed\n2. Hold\n",
      );
    } else {
      chunk(completeNextTodo(turn > 1 ? `received: ${text}\n` : ""));
    }
  } else if (turn === 1) {
    chunk("Pick one.\n\nHITL_GA");
    chunk("TE: demo | Alpha | Beta\n1. Alpha\n2. Beta\n");
  } else {
    chunk(`received: ${text}\n\nLOOP_TICK_RESULT: continue`);
  }
  send({ id, result: { stopReason: "end_turn" } });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  if (process.env.FAKE_CURSOR_ACP_TRACE)
    appendFileSync(process.env.FAKE_CURSOR_ACP_TRACE, `${line}\n`);
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && !msg.method) {
    const resolve = waiting.get(msg.id);
    waiting.delete(msg.id);
    resolve?.(msg);
    return;
  }
  switch (msg.method) {
    case "initialize":
      send({
        id: msg.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            mcpCapabilities: { http: true, sse: true },
            promptCapabilities: { audio: false, embeddedContext: false, image: true },
            sessionCapabilities: { list: {} },
          },
          authMethods: [
            {
              id: "cursor_login",
              name: "Cursor Login",
              description:
                "Authenticate using existing Cursor login credentials. Run 'agent login' first if not logged in.",
            },
          ],
        },
      });
      break;
    case "authenticate":
      if (mode === "auth-fail")
        send({ id: msg.id, error: { code: -32000, message: "Not logged in" } });
      else send({ id: msg.id, result: {} });
      break;
    case "session/new":
      send({ id: msg.id, result: { sessionId: SESSION } });
      break;
    case "session/prompt": {
      const text = (msg.params?.prompt ?? []).map((p) => p?.text ?? "").join("");
      void prompt(msg.id, text);
      break;
    }
    case "session/cancel":
      break;
    default:
      if (msg.id !== undefined)
        send({ id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
rl.on("close", () => {
  if (process.env.FAKE_CURSOR_ACP_LINGER === "1") setInterval(() => {}, 1000);
});
