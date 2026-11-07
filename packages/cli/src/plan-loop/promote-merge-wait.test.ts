import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROMOTE_MERGE_WAIT_MS,
  formatPromoteMergeWaitResult,
  MAX_PROMOTE_MERGE_WAIT_MS,
  MIN_PROMOTE_MERGE_WAIT_MS,
  PROMOTE_MERGE_POLL_INITIAL_MS,
  PROMOTE_MERGE_POLL_MAX_MS,
  PROMOTE_MERGE_WAIT_ASK_ID,
  PROMOTE_MERGE_WAIT_CONFIG_KEY,
  PROMOTE_MERGE_WAIT_LABELS,
  type PromotePrState,
  parsePromotePrView,
  promoteMergePollDelays,
  resolvePromoteMergeWaitMs,
  waitForPromoteMerge,
} from "./promote-merge-wait.js";

const open: PromotePrState = {
  state: "OPEN",
  mergedAt: null,
  mergeCommit: null,
  mergeStateStatus: "CLEAN",
  url: "https://github.com/o/r/pull/1386",
};
const merged: PromotePrState = {
  state: "MERGED",
  mergedAt: "2026-11-02T16:16:28Z",
  mergeCommit: "9674a78e",
  mergeStateStatus: "UNKNOWN",
  url: open.url,
};

describe("promote merge wait: Ask and config contract", () => {
  it("registers the ask id and the exact labels from the plan", () => {
    expect(PROMOTE_MERGE_WAIT_ASK_ID).toBe("promote-merge-wait");
    expect(PROMOTE_MERGE_WAIT_LABELS).toEqual([
      "Keep waiting",
      "Show the merge box reason",
      "Stop and hand off",
    ]);
    for (const label of PROMOTE_MERGE_WAIT_LABELS) expect(label).not.toContain("|");
  });

  it("defaults the cap to 60 minutes under config key promoteMergeWaitMs", () => {
    expect(PROMOTE_MERGE_WAIT_CONFIG_KEY).toBe("promoteMergeWaitMs");
    expect(DEFAULT_PROMOTE_MERGE_WAIT_MS).toBe(60 * 60 * 1000);
    expect(resolvePromoteMergeWaitMs(null)).toBe(DEFAULT_PROMOTE_MERGE_WAIT_MS);
    expect(resolvePromoteMergeWaitMs({})).toBe(DEFAULT_PROMOTE_MERGE_WAIT_MS);
  });

  it("reads the cap from config, ignores junk and clamps to the documented range", () => {
    expect(resolvePromoteMergeWaitMs({ promoteMergeWaitMs: 900_000 })).toBe(900_000);
    expect(resolvePromoteMergeWaitMs({ promoteMergeWaitMs: "900000" })).toBe(
      DEFAULT_PROMOTE_MERGE_WAIT_MS,
    );
    expect(resolvePromoteMergeWaitMs({ promoteMergeWaitMs: Number.NaN })).toBe(
      DEFAULT_PROMOTE_MERGE_WAIT_MS,
    );
    expect(resolvePromoteMergeWaitMs({ promoteMergeWaitMs: 0 })).toBe(MIN_PROMOTE_MERGE_WAIT_MS);
    expect(resolvePromoteMergeWaitMs({ promoteMergeWaitMs: 10 ** 12 })).toBe(
      MAX_PROMOTE_MERGE_WAIT_MS,
    );
  });
});

describe("promoteMergePollDelays (backoff and cap)", () => {
  it("doubles from the initial delay up to the max and sums exactly to the cap", () => {
    const delays = promoteMergePollDelays(20 * 60 * 1000);
    expect(delays.slice(0, 5)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000]);
    expect(Math.max(...delays)).toBe(PROMOTE_MERGE_POLL_MAX_MS);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(20 * 60 * 1000);
  });

  it("trims the last delay so a short cap is never exceeded", () => {
    expect(promoteMergePollDelays(100_000)).toEqual([30_000, 60_000, 10_000]);
    expect(promoteMergePollDelays(10_000)).toEqual([10_000]);
  });

  it("default cap gives a finite schedule", () => {
    const delays = promoteMergePollDelays(DEFAULT_PROMOTE_MERGE_WAIT_MS);
    expect(delays[0]).toBe(PROMOTE_MERGE_POLL_INITIAL_MS);
    expect(delays.length).toBeLessThan(20);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(DEFAULT_PROMOTE_MERGE_WAIT_MS);
  });
});

describe("parsePromotePrView", () => {
  it("parses gh pr view --json output", () => {
    const json = JSON.stringify({
      state: "MERGED",
      mergedAt: "2026-11-02T16:16:28Z",
      mergeCommit: { oid: "9674a78e" },
      mergeStateStatus: "UNKNOWN",
      url: open.url,
    });
    expect(parsePromotePrView(json)).toEqual(merged);
  });

  it("returns null for junk or an unknown state", () => {
    expect(parsePromotePrView("not json")).toBeNull();
    expect(parsePromotePrView(JSON.stringify({ state: "WEIRD" }))).toBeNull();
    expect(parsePromotePrView("[]")).toBeNull();
  });
});

describe("waitForPromoteMerge", () => {
  const sleep = vi.fn(async (_ms: number) => {});

  it("returns merged as soon as the PR is merged and never sleeps after it", async () => {
    sleep.mockClear();
    const readPr = vi.fn().mockResolvedValueOnce(open).mockResolvedValueOnce(merged);
    const r = await waitForPromoteMerge({ readPr, capMs: 600_000, sleep });
    expect(r.outcome).toBe("merged");
    expect(readPr).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([30_000]);
  });

  it("returns closed for a PR closed without merge", async () => {
    const readPr = vi.fn().mockResolvedValue({ ...open, state: "CLOSED" });
    const r = await waitForPromoteMerge({ readPr, capMs: 600_000, sleep });
    expect(r.outcome).toBe("closed");
    expect(readPr).toHaveBeenCalledTimes(1);
  });

  it("stops at the cap with the Ask, even while GitHub keeps saying CLEAN", async () => {
    sleep.mockClear();
    const readPr = vi.fn().mockResolvedValue(open);
    const r = await waitForPromoteMerge({ readPr, capMs: 100_000, sleep });
    expect(r.outcome).toBe("timeout");
    if (r.outcome !== "timeout") throw new Error("unreachable");
    expect(r.waitedMs).toBe(100_000);
    expect(r.polls).toBe(4);
    expect(r.last).toEqual(open);
    expect(r.ask).toEqual({ id: "promote-merge-wait", labels: [...PROMOTE_MERGE_WAIT_LABELS] });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([30_000, 60_000, 10_000]);
  });

  it("treats a read error as a missed poll and reports the last error at the cap", async () => {
    const readPr = vi.fn().mockRejectedValue(new Error("gh: HTTP 502"));
    const r = await waitForPromoteMerge({ readPr, capMs: 40_000, sleep });
    expect(r.outcome).toBe("timeout");
    if (r.outcome !== "timeout") throw new Error("unreachable");
    expect(r.last).toBeNull();
    expect(r.lastError).toContain("HTTP 502");
  });
});

describe("formatPromoteMergeWaitResult", () => {
  it("names the Ask id and labels on timeout, without a HITL_GATE sentinel", async () => {
    const readPr = vi.fn().mockResolvedValue(open);
    const r = await waitForPromoteMerge({ readPr, capMs: 60_000, sleep: async () => {} });
    const text = formatPromoteMergeWaitResult(1386, r);
    expect(text).toContain("promote-merge-wait");
    expect(text).toContain("Keep waiting / Show the merge box reason / Stop and hand off");
    expect(text).toContain("mergeStateStatus CLEAN");
    expect(text).toMatch(/CLEAN.*not proof/);
    expect(text).not.toMatch(/^HITL_GATE:/m);
  });

  it("reports merged with the merge commit", () => {
    const text = formatPromoteMergeWaitResult(1386, { outcome: "merged", pr: merged, polls: 2 });
    expect(text).toContain("merged");
    expect(text).toContain("9674a78e");
  });
});
