/**
 * Bounded wait for the operator merge of a staging→main promote PR.
 *
 * `/git-prod` (PR path), factory `/kit-prod` and the `/run-plan-all` ship lane
 * used to say "wait for the operator to merge the PR" with no interval and no
 * end. GitHub can refuse that merge for a ruleset reason while it reports
 * `MERGEABLE`/`CLEAN` and every check is green, so the wait never ended
 * (memory `errors/2026-11-02_promote-pr-refused-base-branch-policy-clean.md`).
 *
 * This module polls the PR read-only with backoff, stops at a cap (config key
 * `promoteMergeWaitMs`), and hands the caller the `promote-merge-wait` Ask.
 * It never merges, never calls `/git-prod`, and never retries past the cap.
 */

/** Ask id registered in `.cursor/skills/core/hitl-gates/SKILL.md`. */
export const PROMOTE_MERGE_WAIT_ASK_ID = "promote-merge-wait";

export const PROMOTE_MERGE_WAIT_LABELS = [
  "Keep waiting",
  "Show the merge box reason",
  "Stop and hand off",
] as const;

/** Top-level key in `.cursor/context/config.json`. */
export const PROMOTE_MERGE_WAIT_CONFIG_KEY = "promoteMergeWaitMs";

/** Default cap: 60 minutes. The wait is operator-paced, not CI-paced. */
export const DEFAULT_PROMOTE_MERGE_WAIT_MS = 60 * 60 * 1000;
export const MIN_PROMOTE_MERGE_WAIT_MS = 60 * 1000;
export const MAX_PROMOTE_MERGE_WAIT_MS = 24 * 60 * 60 * 1000;

/** First delay between reads; doubles up to the max. */
export const PROMOTE_MERGE_POLL_INITIAL_MS = 30_000;
export const PROMOTE_MERGE_POLL_MAX_MS = 5 * 60 * 1000;

/** Cap from config: a finite number, clamped to the documented range; anything else is the default. */
export function resolvePromoteMergeWaitMs(config: Record<string, unknown> | null): number {
  const raw = config?.[PROMOTE_MERGE_WAIT_CONFIG_KEY];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_PROMOTE_MERGE_WAIT_MS;
  return Math.min(MAX_PROMOTE_MERGE_WAIT_MS, Math.max(MIN_PROMOTE_MERGE_WAIT_MS, Math.trunc(raw)));
}

/**
 * Delays between reads: doubling backoff from `initialMs` up to `maxMs`, the
 * last one trimmed so the sum is exactly `capMs`. Always finite.
 */
export function promoteMergePollDelays(
  capMs: number,
  initialMs: number = PROMOTE_MERGE_POLL_INITIAL_MS,
  maxMs: number = PROMOTE_MERGE_POLL_MAX_MS,
): number[] {
  const cap = Math.max(1, Math.trunc(Number(capMs) || 0));
  const max = Math.max(1, Math.trunc(maxMs));
  let next = Math.min(max, Math.max(1, Math.trunc(initialMs)));
  const delays: number[] = [];
  let total = 0;
  while (total < cap) {
    const d = Math.min(next, cap - total);
    delays.push(d);
    total += d;
    next = Math.min(max, next * 2);
  }
  return delays;
}

export type PromotePrState = {
  state: "OPEN" | "MERGED" | "CLOSED";
  mergedAt: string | null;
  mergeCommit: string | null;
  /** GitHub `mergeStateStatus`. `CLEAN` is not proof that a merge will be accepted. */
  mergeStateStatus: string | null;
  url: string | null;
};

/** Fields to request: `gh pr view <N> --json <PROMOTE_PR_VIEW_FIELDS>`. */
export const PROMOTE_PR_VIEW_FIELDS = "state,mergedAt,mergeCommit,mergeStateStatus,url";

/** Parse `gh pr view --json` output; null when it is not a PR object with a known state. */
export function parsePromotePrView(json: string): PromotePrState | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.state !== "OPEN" && o.state !== "MERGED" && o.state !== "CLOSED") return null;
  const commit = o.mergeCommit as { oid?: unknown } | null | undefined;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    state: o.state,
    mergedAt: str(o.mergedAt),
    mergeCommit: str(commit?.oid),
    mergeStateStatus: str(o.mergeStateStatus),
    url: str(o.url),
  };
}

export type PromoteMergeWaitResult =
  | { outcome: "merged"; pr: PromotePrState; polls: number }
  | { outcome: "closed"; pr: PromotePrState; polls: number }
  | {
      outcome: "timeout";
      last: PromotePrState | null;
      lastError: string | null;
      polls: number;
      waitedMs: number;
      ask: { id: typeof PROMOTE_MERGE_WAIT_ASK_ID; labels: string[] };
    };

/**
 * Poll the PR until it is merged, closed, or the cap is reached. A failed
 * read counts as a missed poll (never an early end, never a merge attempt).
 */
export async function waitForPromoteMerge(opts: {
  readPr: () => Promise<PromotePrState | null>;
  capMs: number;
  sleep?: (ms: number) => Promise<void>;
  initialDelayMs?: number;
  maxDelayMs?: number;
}): Promise<PromoteMergeWaitResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = promoteMergePollDelays(opts.capMs, opts.initialDelayMs, opts.maxDelayMs);
  let last: PromotePrState | null = null;
  let lastError: string | null = null;
  let polls = 0;
  let waitedMs = 0;
  for (let i = 0; i <= delays.length; i++) {
    polls += 1;
    try {
      const pr = await opts.readPr();
      if (pr) {
        last = pr;
        if (pr.state === "MERGED") return { outcome: "merged", pr, polls };
        if (pr.state === "CLOSED") return { outcome: "closed", pr, polls };
      } else {
        lastError = "unreadable PR state";
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    const delay = delays[i];
    if (delay === undefined) break;
    await sleep(delay);
    waitedMs += delay;
  }
  return {
    outcome: "timeout",
    last,
    lastError,
    polls,
    waitedMs,
    ask: { id: PROMOTE_MERGE_WAIT_ASK_ID, labels: [...PROMOTE_MERGE_WAIT_LABELS] },
  };
}

function minutes(ms: number): string {
  const m = ms / 60_000;
  return Number.isInteger(m) ? `${m} min` : `${m.toFixed(1)} min`;
}

/**
 * Human report for the caller. On timeout it names the Ask id and labels so
 * the agent opens that Ask itself; it never prints a `HITL_GATE:` sentinel
 * (the sentinel belongs to the agent's own message, not to tool output).
 */
export function formatPromoteMergeWaitResult(pr: number, result: PromoteMergeWaitResult): string {
  if (result.outcome === "merged") {
    const sha = result.pr.mergeCommit ? ` as ${result.pr.mergeCommit}` : "";
    const at = result.pr.mergedAt ? ` at ${result.pr.mergedAt}` : "";
    return `PR #${pr} merged${sha}${at}. Continue the promote routine.\n`;
  }
  if (result.outcome === "closed") {
    return `PR #${pr} was closed without a merge. Stop: do not tag, do not reopen it, report to the operator.\n`;
  }
  const lines = [
    `PR #${pr} is still not merged after ${minutes(result.waitedMs)} (${result.polls} reads; cap: ${PROMOTE_MERGE_WAIT_CONFIG_KEY}).`,
  ];
  if (result.last) {
    lines.push(
      `Last read: state ${result.last.state}, mergeStateStatus ${result.last.mergeStateStatus ?? "unknown"}${result.last.url ? `, ${result.last.url}` : ""}.`,
    );
  }
  if (result.lastError) lines.push(`Last read error: ${result.lastError}.`);
  if (result.last?.mergeStateStatus === "CLEAN") {
    lines.push(
      "CLEAN plus green checks is not proof that GitHub will accept the merge: a ruleset can still refuse it. The PR page merge box names the reason.",
    );
  }
  lines.push(
    `Ask ${result.ask.id}: ${result.ask.labels.join(" / ")}. Never merge the PR yourself and never run /git-prod.`,
  );
  return `${lines.join("\n")}\n`;
}
