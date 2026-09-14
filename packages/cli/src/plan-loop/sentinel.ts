import { readFile } from "node:fs/promises";

const SENTINEL_RE = /LOOP_TICK_RESULT:\s*(continue|stop(?:\s*[—\-].*)?)/i;

export type TickSentinel =
  | { kind: "continue" }
  | { kind: "stop"; reason: string }
  | { kind: "missing" };

function takeFromText(text: string): TickSentinel | null {
  if (!text) return null;
  const m = SENTINEL_RE.exec(text);
  if (!m?.[1]) return null;
  const raw = m[1].trim();
  if (raw.toLowerCase().startsWith("stop")) {
    const reason =
      raw
        .slice(4)
        .replace(/^[—\-\s]+/, "")
        .trim() || "requested by agent";
    return { kind: "stop", reason };
  }
  return { kind: "continue" };
}

/**
 * Prefer the final stream-json `result` event; fall back to any streamed text.
 * Mirrors the Python block in scripts/plan-loop.sh (pre-CLI).
 */
export function parseSentinelFromLog(content: string): TickSentinel {
  let last: TickSentinel | null = null;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!trimmed.startsWith("{")) {
      const hit = takeFromText(trimmed);
      if (hit) last = hit;
      continue;
    }

    try {
      const ev = JSON.parse(trimmed) as {
        type?: string;
        result?: unknown;
        message?: { content?: unknown[] };
      };
      if (ev.type === "result" && typeof ev.result === "string") {
        const hit = takeFromText(ev.result);
        if (hit) last = hit;
      }
      const parts = ev.message?.content;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            const hit = takeFromText((part as { text: string }).text);
            if (hit) last = hit;
          }
        }
      }
    } catch {
      const hit = takeFromText(trimmed);
      if (hit) last = hit;
    }
  }

  return last ?? { kind: "missing" };
}

/**
 * Outcome of the last stream-json `result` event. `claude -p` reports in-run
 * failures (missing auth, gateway 401, `--max-turns` hit) as the result on
 * stdout with `is_error: true` and a `subtype` such as `error_during_execution`,
 * `error_max_turns`, `error_max_budget_usd`; the exit code that accompanies it
 * is undocumented, so the loop branches on this rather than on a number.
 * `null` when no result event was found (plain-text output, cursor-agent, or
 * a run that died before its result line).
 */
export interface TickResultStatus {
  isError: boolean;
  subtype?: string;
  errors: string[];
}

export function parseTickResultStatus(content: string): TickResultStatus | null {
  let last: TickResultStatus | null = null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const ev = JSON.parse(trimmed) as {
        type?: string;
        subtype?: unknown;
        is_error?: unknown;
        errors?: unknown;
      };
      if (ev.type !== "result") continue;
      const errors = Array.isArray(ev.errors)
        ? ev.errors.filter((e): e is string => typeof e === "string")
        : [];
      last = {
        isError: ev.is_error === true,
        ...(typeof ev.subtype === "string" ? { subtype: ev.subtype } : {}),
        errors,
      };
    } catch {
      // not JSON
    }
  }
  return last;
}

export async function parseTickResultStatusFromLogFile(
  logPath: string,
): Promise<TickResultStatus | null> {
  try {
    return parseTickResultStatus(await readFile(logPath, "utf8"));
  } catch {
    return null;
  }
}

export async function parseSentinelFromLogFile(logPath: string): Promise<TickSentinel> {
  try {
    const content = await readFile(logPath, "utf8");
    return parseSentinelFromLog(content);
  } catch {
    return { kind: "missing" };
  }
}

export function formatSentinelLine(sentinel: TickSentinel): string {
  if (sentinel.kind === "continue") return "LOOP_TICK_RESULT: continue";
  if (sentinel.kind === "stop") return `LOOP_TICK_RESULT: stop - ${sentinel.reason}`;
  return "";
}
