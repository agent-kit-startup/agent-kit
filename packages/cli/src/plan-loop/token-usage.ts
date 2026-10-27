/**
 * Token usage for the driver events `tick_end.usage` and `run_end.usage`
 * (driver protocol 1.3.0). The numbers are the backend's own: they come from
 * the `result` events of the agent stream (claude stream-json, the claude-style
 * translation of codex's JSONL) and are only added up, never estimated. A run
 * whose backend reported nothing carries `null`.
 *
 * Normalized shape, the same for every backend: `inputTokens` counts every
 * input token the models read, cached or not; `cachedInputTokens` is the part
 * of it served from a prompt cache (`null` when the backend does not split it);
 * `totalTokens` is `inputTokens + outputTokens`.
 *
 * Sources, by shape:
 * - claude: `result.modelUsage` (one entry per model, subagents included) is
 *   the session's running total, so a later report replaces an earlier one.
 *   `result.usage` is not used when `modelUsage` is present: it is the main
 *   thread's last turn only. Input = `inputTokens + cacheReadInputTokens +
 *   cacheCreationInputTokens`; cached = `cacheReadInputTokens`.
 * - codex: `turn.completed.usage` (translated onto `result.usage`, recognised
 *   by `cached_input_tokens`) is the thread's running total, also after
 *   `codex exec resume` (codex seeds it from the rollout), so a later report
 *   replaces an earlier one. Its `input_tokens` already includes the cached
 *   part.
 * - any other `result.usage` with `input_tokens` / `output_tokens` (claude
 *   shape without `modelUsage`) is one turn: reports for a session add up.
 *
 * Node built-ins only (thin-deps ADRs 2026-08-27, 2026-09-05).
 */

export interface DriverUsage {
  /** Every input token the models read, cached included. */
  inputTokens: number;
  /** Part of `inputTokens` read from a prompt cache, or null when the backend does not report it. */
  cachedInputTokens: number | null;
  outputTokens: number;
  /** `inputTokens + outputTokens`. */
  totalTokens: number;
}

/** One `result` event's usage and whether it is the session's running total. */
export interface ResultUsage {
  usage: DriverUsage;
  /** True: the session total so far (later replaces earlier). False: one turn (adds up). */
  cumulative: boolean;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** A token count the backend reported: a finite non-negative integer, else undefined. */
const count = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

const make = (input: number, cached: number | null, output: number): DriverUsage => ({
  inputTokens: input,
  cachedInputTokens: cached,
  outputTokens: output,
  totalTokens: input + output,
});

function fromModelUsage(models: unknown): DriverUsage | null {
  if (!isRecord(models)) return null;
  let seen = false;
  let input = 0;
  let cached = 0;
  let output = 0;
  for (const m of Object.values(models)) {
    if (!isRecord(m)) continue;
    const i = count(m.inputTokens);
    const o = count(m.outputTokens);
    if (i === undefined && o === undefined) continue;
    seen = true;
    const read = count(m.cacheReadInputTokens) ?? 0;
    input += (i ?? 0) + read + (count(m.cacheCreationInputTokens) ?? 0);
    cached += read;
    output += o ?? 0;
  }
  return seen ? make(input, cached, output) : null;
}

/** Usage carried by one stream-json `result` event, or null when it carries none. */
export function readResultUsage(event: Rec): ResultUsage | null {
  const models = fromModelUsage(event.modelUsage);
  if (models) return { usage: models, cumulative: true };
  const u = event.usage;
  if (!isRecord(u)) return null;
  const i = count(u.input_tokens);
  const o = count(u.output_tokens);
  if (i === undefined && o === undefined) return null;
  const codexCached = count(u.cached_input_tokens);
  if (codexCached !== undefined) {
    return { usage: make(i ?? 0, codexCached, o ?? 0), cumulative: true };
  }
  const read = count(u.cache_read_input_tokens);
  const write = count(u.cache_creation_input_tokens);
  return {
    usage: make((i ?? 0) + (read ?? 0) + (write ?? 0), read ?? null, o ?? 0),
    cumulative: false,
  };
}

/** Sum of two usages; null only when both are. */
export function sumUsage(a: DriverUsage | null, b: DriverUsage | null): DriverUsage | null {
  if (!a) return b;
  if (!b) return a;
  const cached =
    a.cachedInputTokens === null && b.cachedInputTokens === null
      ? null
      : (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  return make(a.inputTokens + b.inputTokens, cached, a.outputTokens + b.outputTokens);
}

/**
 * Usage of one backend run, keyed by the stream's `session_id`: a cumulative
 * report replaces the session's earlier one, per-turn reports add up, and
 * distinct sessions add up. A session that has a cumulative report ignores
 * later per-turn ones (one source per session).
 */
export class UsageTally {
  private readonly sessions = new Map<string, ResultUsage>();

  note(sessionId: string | null | undefined, report: ResultUsage | null | undefined): void {
    if (!report) return;
    const key = sessionId ?? "";
    const prev = this.sessions.get(key);
    if (report.cumulative || !prev) {
      this.sessions.set(key, report);
      return;
    }
    if (prev.cumulative) return;
    this.sessions.set(key, {
      cumulative: false,
      usage: sumUsage(prev.usage, report.usage) as DriverUsage,
    });
  }

  /** Apply another tally's reports after this one's (a resumed child of the same tick). */
  merge(other: UsageTally): void {
    for (const [key, report] of other.sessions) this.note(key, report);
  }

  total(): DriverUsage | null {
    let sum: DriverUsage | null = null;
    for (const report of this.sessions.values()) sum = sumUsage(sum, report.usage);
    return sum;
  }
}
