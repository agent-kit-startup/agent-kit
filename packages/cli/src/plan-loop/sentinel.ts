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
