/**
 * One-line parser for the `stream-json` NDJSON a headless agent CLI writes
 * to stdout (`claude -p --output-format stream-json --verbose` and
 * `cursor-agent -p --output-format stream-json`). Each line becomes zero or
 * more renderable events; anything the renderer does not show is `silent`,
 * and a line that is not JSON is `unparsed`. Parsing never throws.
 */

export type StreamEvent =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; name: string; summary: string }
  | { kind: "tool_result"; ok: boolean; line: string }
  | {
      kind: "result";
      ok: boolean;
      status: string;
      costUsd?: number;
      durationMs?: number;
      apiMs?: number;
      turns?: number;
    }
  | { kind: "hook"; name: string; phase: string; detail: string }
  | { kind: "rate_limit"; line: string; severe: boolean }
  | { kind: "prompt"; chars: number }
  /** A relayed operator reply echoed by the child (`HITL_REPLY:` user event, `isReplay: true`). */
  | { kind: "hitl_reply"; line: string }
  | { kind: "silent" }
  | { kind: "unparsed" };

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Collapse whitespace to one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Keys shown first in a tool argument summary, in order of preference. */
const SUMMARY_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "description",
  "prompt",
  "content",
] as const;

/**
 * One-line summary of a tool call's arguments: the first well-known key
 * present, else the compact JSON of the whole input.
 */
export function summarizeToolInput(input: unknown): string {
  if (typeof input === "string") return oneLine(input);
  if (!isRecord(input)) return input === undefined ? "" : oneLine(JSON.stringify(input));
  for (const key of SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return oneLine(value);
  }
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  return oneLine(JSON.stringify(input));
}

/** First non-empty line of a tool result payload (string or content parts). */
export function firstLineOfContent(content: unknown): string {
  if (typeof content === "string") return firstNonEmptyLine(content);
  if (Array.isArray(content)) {
    for (const part of content) {
      if (isRecord(part) && typeof part.text === "string") {
        const line = firstNonEmptyLine(part.text);
        if (line) return line;
      }
    }
    return "";
  }
  if (isRecord(content)) return oneLine(JSON.stringify(content));
  return "";
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function parseAssistant(event: Json): StreamEvent[] {
  const message = event.message;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") return content ? [{ kind: "text", text: content }] : [];
  if (!Array.isArray(content)) return [{ kind: "silent" }];
  const out: StreamEvent[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    const type = asString(part.type);
    if (type === "text" && typeof part.text === "string") {
      if (part.text) out.push({ kind: "text", text: part.text });
    } else if (type === "tool_use" || type === "server_tool_use") {
      out.push({
        kind: "tool_use",
        name: asString(part.name) ?? "tool",
        summary: summarizeToolInput(part.input),
      });
    }
  }
  return out.length > 0 ? out : [{ kind: "silent" }];
}

const HITL_REPLY_PREFIX = "HITL_REPLY:";

function parseUser(event: Json): StreamEvent[] {
  const message = event.message;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content === "string") {
    if (event.isReplay === true && content.startsWith(HITL_REPLY_PREFIX)) {
      return [{ kind: "hitl_reply", line: oneLine(content) }];
    }
    return [{ kind: "prompt", chars: content.length }];
  }
  if (!Array.isArray(content)) return [{ kind: "silent" }];
  const out: StreamEvent[] = [];
  let promptChars = 0;
  for (const part of content) {
    if (!isRecord(part)) continue;
    const type = asString(part.type);
    if (type === "tool_result") {
      out.push({
        kind: "tool_result",
        ok: part.is_error !== true,
        line: firstLineOfContent(part.content),
      });
    } else if (type === "text" && typeof part.text === "string") {
      if (event.isReplay === true && part.text.startsWith(HITL_REPLY_PREFIX)) {
        out.push({ kind: "hitl_reply", line: oneLine(part.text) });
        continue;
      }
      promptChars += part.text.length;
    }
  }
  if (promptChars > 0) out.push({ kind: "prompt", chars: promptChars });
  return out.length > 0 ? out : [{ kind: "silent" }];
}

function parseResult(event: Json): StreamEvent {
  const isError = event.is_error === true;
  const subtype = asString(event.subtype);
  return {
    kind: "result",
    ok: !isError,
    status: subtype ?? (isError ? "error" : "success"),
    costUsd: asNumber(event.total_cost_usd),
    durationMs: asNumber(event.duration_ms),
    apiMs: asNumber(event.duration_api_ms),
    turns: asNumber(event.num_turns),
  };
}

function parseSystem(event: Json): StreamEvent {
  const subtype = asString(event.subtype) ?? "";
  if (!subtype.startsWith("hook_")) return { kind: "silent" };
  const phase = subtype.slice("hook_".length);
  const name = asString(event.hook_name) ?? asString(event.hook_event) ?? "hook";
  const details: string[] = [];
  const outcome = asString(event.outcome);
  if (outcome) details.push(outcome);
  const exitCode = asNumber(event.exit_code);
  if (exitCode !== undefined) details.push(`exit ${exitCode}`);
  return { kind: "hook", name, phase, detail: details.join(", ") };
}

function percent(value: unknown): string | null {
  const n = asNumber(value);
  return n === undefined ? null : `${Math.round(n * 100)}%`;
}

function parseRateLimit(event: Json): StreamEvent {
  const info = isRecord(event.rate_limit_info) ? event.rate_limit_info : event;
  const status = asString(info.status) ?? "unknown";
  const type = asString(info.rateLimitType);
  const parts: string[] = [];
  if (type) parts.push(type);
  parts.push(status);
  const windows = isRecord(info.unifiedWindows) ? info.unifiedWindows : null;
  if (windows) {
    for (const [name, window] of Object.entries(windows)) {
      if (!isRecord(window)) continue;
      const used = percent(window.utilization);
      if (used) parts.push(`${name} ${used}`);
    }
  }
  return { kind: "rate_limit", line: parts.join(" · "), severe: status !== "allowed" };
}

/** `cursor-agent` tool events: `{type:"tool_call", subtype, tool_call:{<kind>ToolCall:{args, result}}}`. */
function parseCursorToolCall(event: Json): StreamEvent {
  const call = isRecord(event.tool_call) ? event.tool_call : null;
  const entry = call ? Object.entries(call).find(([, v]) => isRecord(v)) : undefined;
  const name = entry ? entry[0].replace(/ToolCall$/, "") : "tool";
  const body = entry && isRecord(entry[1]) ? entry[1] : {};
  const subtype = asString(event.subtype) ?? "";
  if (subtype === "started") {
    return { kind: "tool_use", name, summary: summarizeToolInput(body.args) };
  }
  if (subtype === "completed") {
    const result = isRecord(body.result) ? body.result : null;
    const failed =
      result !== null && ("error" in result || "failure" in result || "rejected" in result);
    let line = "";
    if (result) {
      const payload = failed ? (result.error ?? result.failure ?? result.rejected) : result.success;
      line = firstLineOfContent(
        typeof payload === "string" ? payload : payload === undefined ? result : payload,
      );
    }
    return { kind: "tool_result", ok: !failed, line };
  }
  return { kind: "silent" };
}

/**
 * Parse one complete NDJSON line. Returns `[{kind:"unparsed"}]` for a line
 * that is not a JSON object, `[{kind:"silent"}]` for an event the renderer
 * does not show, and never throws.
 */
export function parseStreamLine(line: string): StreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return [{ kind: "unparsed" }];
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return [{ kind: "unparsed" }];
  }
  if (!isRecord(event)) return [{ kind: "unparsed" }];
  switch (asString(event.type)) {
    case "assistant":
      return parseAssistant(event);
    case "user":
      return parseUser(event);
    case "result":
      return [parseResult(event)];
    case "system":
      return [parseSystem(event)];
    case "rate_limit_event":
      return [parseRateLimit(event)];
    case "tool_call":
      return [parseCursorToolCall(event)];
    default:
      return [{ kind: "silent" }];
  }
}
