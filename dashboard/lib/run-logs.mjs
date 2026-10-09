/**
 * Headless run feed for Mission Control: the kit's own `.cursor/loop-logs/`
 * (`tick-*.log` from `agent-kit run-plan`, `run-*.log` from `agent-kit run`),
 * so the panel and an embedding host can show agent output, gates and tick
 * results without reading `~/.cursor/projects` (ADR 2026-10-08
 * mission-control-embeddable-contract).
 *
 * The logs are already redacted when the CLI writes them; a caller-supplied
 * `redact` runs again over every string this module returns. Read-only and
 * bounded: newest MAX_RUN_LOGS files, the last MAX_RUN_LOG_BYTES of each.
 * Understands the three shapes the backends write: claude / cursor-agent
 * stream-json, codex `exec --json`, and the cursor-acp JSON-RPC transcript.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const MAX_RUN_LOGS = 10;
export const MAX_RUN_LOG_BYTES = 256 * 1024;
export const MAX_RUN_LOG_TEXT = 600;
const MAX_LIST = 10;

const LOG_NAME_RE = /^(tick|run)-[0-9-]+\.log$/;
const GATE_RE = /^HITL_GATE:\s*([a-z0-9-]+)\s*\|/m;
const SENTINEL_RE = /LOOP_TICK_RESULT:\s*(continue|stop(?:\s*[—-].*)?)/i;
const REPLY_RE = /HITL_REPLY:\s*[a-z0-9-]+\s*\|[^\n]*/;

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function cap(text, max = MAX_RUN_LOG_TEXT) {
  const s = String(text ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/**
 * Summary of one log's text: backend shape, session id, last agent text,
 * the final result, the `LOOP_TICK_RESULT` line, gate ids and reply stamps.
 * Never throws; unknown lines are skipped.
 */
export function summarizeRunLog(text, redact = (s) => s) {
  const out = {
    format: null,
    sessionId: null,
    events: 0,
    lastText: "",
    result: null,
    sentinel: null,
    gates: [],
    replies: [],
  };
  let acpTurn = "";
  const noteText = (t) => {
    if (!t) return;
    out.lastText = t;
    const gate = GATE_RE.exec(t);
    if (gate?.[1] && out.gates.length < MAX_LIST) out.gates.push(gate[1]);
  };
  const noteReply = (t) => {
    const m = REPLY_RE.exec(t);
    if (m && out.replies.length < MAX_LIST) out.replies.push(m[0].trim());
  };
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(ev)) continue;
    out.events += 1;
    // cursor-acp: JSON-RPC 2.0 transcript (both directions).
    if (ev.jsonrpc === "2.0") {
      out.format ??= "acp";
      const params = isRecord(ev.params) ? ev.params : null;
      if (ev.method === "session/update" && isRecord(params?.update)) {
        const u = params.update;
        if (u.sessionUpdate === "agent_message_chunk" && isRecord(u.content)) {
          acpTurn += typeof u.content.text === "string" ? u.content.text : "";
        }
      } else if (ev.method === "session/prompt" && params) {
        noteReply(textOf(params.prompt));
      } else if (isRecord(ev.result) && typeof ev.result.sessionId === "string") {
        out.sessionId = ev.result.sessionId;
      } else if (isRecord(ev.result) && typeof ev.result.stopReason === "string") {
        noteText(acpTurn);
        out.result = { isError: false, subtype: ev.result.stopReason, text: cap(acpTurn) };
        acpTurn = "";
      } else if (isRecord(ev.error) && ev.id !== undefined && !ev.method) {
        const message = typeof ev.error.message === "string" ? ev.error.message : "error";
        out.result = { isError: true, subtype: "error", text: cap(message) };
      }
      continue;
    }
    const type = ev.type;
    // codex exec --json
    if (type === "thread.started" || type === "turn.completed" || type === "turn.failed") {
      out.format ??= "codex";
    }
    if (type === "thread.started" && typeof ev.thread_id === "string") out.sessionId = ev.thread_id;
    else if (type === "item.completed" && isRecord(ev.item)) {
      const kind = ev.item.type ?? ev.item.item_type;
      if (
        (kind === "agent_message" || kind === "assistant_message") &&
        typeof ev.item.text === "string"
      ) {
        noteText(ev.item.text);
      }
    } else if (type === "turn.completed") {
      out.result = { isError: false, subtype: "success", text: cap(out.lastText) };
    } else if (type === "turn.failed") {
      const message =
        isRecord(ev.error) && typeof ev.error.message === "string" ? ev.error.message : "failed";
      out.result = { isError: true, subtype: "error", text: cap(message) };
    }
    // claude / cursor-agent stream-json
    else if (type === "system" && ev.subtype === "init") {
      out.format ??= "stream-json";
      if (typeof ev.session_id === "string") out.sessionId = ev.session_id;
    } else if (type === "assistant" && isRecord(ev.message)) {
      noteText(textOf(ev.message.content));
    } else if (type === "user" && ev.isReplay === true && isRecord(ev.message)) {
      noteReply(textOf(ev.message.content));
    } else if (type === "result") {
      out.format ??= "stream-json";
      const resultText = typeof ev.result === "string" ? ev.result : "";
      if (resultText) noteText(resultText);
      out.result = {
        isError: ev.is_error === true,
        subtype: typeof ev.subtype === "string" ? ev.subtype : null,
        text: cap(resultText),
      };
    }
  }
  const sentinel = SENTINEL_RE.exec(out.result?.text || out.lastText);
  out.sentinel = sentinel ? `LOOP_TICK_RESULT: ${sentinel[1].trim()}` : null;
  out.lastText = cap(out.lastText);
  out.gates = [...new Set(out.gates)];
  out.lastText = redact(out.lastText);
  if (out.result) out.result.text = redact(out.result.text);
  out.replies = out.replies.map((r) => redact(r));
  return out;
}

/**
 * Runner state dir for the loop logs: mirrors `resolveStateDir` in
 * packages/cli/src/utils/kit-paths.ts (`AGENT_KIT_STATE_ROOT`, `.cursor` or
 * `.agent-kit`, anything else falls back to `.cursor`). HTML/ESM cannot import
 * the TS module; a parity test keeps the two in step.
 */
export function resolveRunnerStateDir(env = process.env) {
  const raw = String(env?.AGENT_KIT_STATE_ROOT ?? "")
    .trim()
    .replace(/\/+$/, "");
  return raw === ".agent-kit" ? ".agent-kit" : ".cursor";
}

/** Read the tail of a file (the newest events matter; the head may be a long prompt echo). */
function readTail(file, size) {
  const text = readFileSync(file, "utf8");
  if (size <= MAX_RUN_LOG_BYTES) return text;
  const tail = text.slice(-MAX_RUN_LOG_BYTES);
  const cut = tail.indexOf("\n");
  return cut === -1 ? tail : tail.slice(cut + 1);
}

/**
 * Rows for the newest headless logs under `<root>/<stateDir>/loop-logs/`.
 * A missing directory or unreadable file yields fewer rows, never an error.
 */
export function collectRunLogs(root, opts = {}) {
  const stateDir = opts.stateDir ?? resolveRunnerStateDir();
  const redact = typeof opts.redact === "function" ? opts.redact : (s) => s;
  const max = opts.max ?? MAX_RUN_LOGS;
  const dir = join(root, stateDir, "loop-logs");
  let names;
  try {
    names = readdirSync(dir).filter((f) => LOG_NAME_RE.test(f));
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    try {
      const st = statSync(join(dir, name));
      if (st.isFile()) files.push({ name, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // vanished between readdir and stat
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));
  const rows = [];
  for (const f of files.slice(0, max)) {
    try {
      const summary = summarizeRunLog(readTail(join(dir, f.name), f.size), redact);
      rows.push({
        id: f.name,
        kind: f.name.startsWith("tick-") ? "tick" : "run",
        path: `${stateDir}/loop-logs/${f.name}`,
        updatedAt: new Date(f.mtimeMs).toISOString(),
        bytes: f.size,
        source: "loop-logs",
        ...summary,
      });
    } catch {
      // unreadable log: skipped
    }
  }
  return rows;
}
