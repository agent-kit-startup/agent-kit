/**
 * Structured "stopped on a vendor usage limit" signal for a headless tick
 * (ADR 2026-09-19 invariant (vi)).
 *
 * Read from the tick log after the child exits (the log is already redacted,
 * so quoting it is safe). Signals, in order:
 * - a claude `rate_limit_event` whose status is neither `allowed` nor
 *   `allowed_warning` (e.g. `rejected`);
 * - a `result` event with `is_error: true` whose text names a limit, or a
 *   codex `turn.failed` / `error` event or an ACP JSON-RPC error response
 *   whose message does;
 * - a non-JSON line (vendor stderr) that names a limit in a fixed phrase.
 * Assistant text is never scanned: an agent quoting "rate limit" is not a stop.
 */

export interface UsageLimitHit {
  source: "rate_limit_event" | "result" | "stderr";
  /** One-line detail for the run summary (status, limit type, reset time when known). */
  detail: string;
}

const LIMIT_TEXT_RE =
  /\b(?:usage|rate)[ _-]?limit|\blimit (?:reached|exceeded)|\bquota (?:exceeded|reached)|\btoo many requests\b|\bout of (?:extra )?usage\b/i;
const NON_LIMIT_STATUSES = new Set(["allowed", "allowed_warning"]);

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function oneLine(text: string, max = 200): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function fromRateLimitEvent(event: Json): UsageLimitHit | null {
  const info = isRecord(event.rate_limit_info) ? event.rate_limit_info : event;
  const status = typeof info.status === "string" ? info.status : null;
  if (!status || NON_LIMIT_STATUSES.has(status)) return null;
  const parts = [status];
  if (typeof info.rateLimitType === "string") parts.unshift(info.rateLimitType);
  if (typeof info.resetsAt === "number" && Number.isFinite(info.resetsAt)) {
    const ms = info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt;
    parts.push(`resets ${new Date(ms).toISOString()}`);
  }
  return { source: "rate_limit_event", detail: parts.join(" ") };
}

function fromErrorResult(event: Json): UsageLimitHit | null {
  if (event.is_error !== true) return null;
  const texts: string[] = [];
  if (typeof event.result === "string") texts.push(event.result);
  if (typeof event.subtype === "string") texts.push(event.subtype);
  if (Array.isArray(event.errors)) {
    for (const e of event.errors) if (typeof e === "string") texts.push(e);
  }
  if (isRecord(event.error) && typeof event.error.message === "string") {
    texts.push(event.error.message);
  }
  const hit = texts.find((t) => LIMIT_TEXT_RE.test(t));
  return hit ? { source: "result", detail: oneLine(hit) } : null;
}

/** codex `exec --json`: `turn.failed` `{error:{message}}` or a top-level `error` `{message}`. */
function fromCodexError(event: Json): UsageLimitHit | null {
  const message =
    isRecord(event.error) && typeof event.error.message === "string"
      ? event.error.message
      : typeof event.message === "string"
        ? event.message
        : "";
  return LIMIT_TEXT_RE.test(message) ? { source: "result", detail: oneLine(message) } : null;
}

const PRIORITY: Record<UsageLimitHit["source"], number> = {
  rate_limit_event: 3,
  result: 2,
  stderr: 1,
};

/**
 * Usage-limit signal in one tick log, or null. The most structured source
 * wins (a `rate_limit_event` carries the window and reset time), then the
 * last signal of that source.
 */
export function detectUsageLimit(logText: string): UsageLimitHit | null {
  let last: UsageLimitHit | null = null;
  const take = (hit: UsageLimitHit) => {
    if (!last || PRIORITY[hit.source] >= PRIORITY[last.source]) last = hit;
  };
  for (const raw of logText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith("{")) {
      if (LIMIT_TEXT_RE.test(line)) take({ source: "stderr", detail: oneLine(line) });
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    const hit =
      event.type === "rate_limit_event"
        ? fromRateLimitEvent(event)
        : event.type === "result"
          ? fromErrorResult(event)
          : event.type === "turn.failed" ||
              event.type === "error" ||
              (event.jsonrpc === "2.0" && isRecord(event.error))
            ? fromCodexError(event)
            : null;
    if (hit) take(hit);
  }
  return last;
}
