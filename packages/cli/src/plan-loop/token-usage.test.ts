import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readResultUsage, sumUsage, UsageTally } from "./token-usage.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("readResultUsage", () => {
  it("claude: sums modelUsage over every model (subagents included) as a cumulative report", async () => {
    const log = await readFile(
      path.join(FIXTURES, "claude-stream-run-plan-all-queue-drift.log"),
      "utf8",
    );
    const line = log.split("\n").find((l) => l.includes('"type":"result"'));
    const report = readResultUsage(JSON.parse(line as string) as Record<string, unknown>);
    // haiku 12158 + opus (16 + 426236 cache read + 67662 cache write) + fable 73216
    expect(report).toEqual({
      cumulative: true,
      usage: {
        inputTokens: 579288,
        cachedInputTokens: 426236,
        outputTokens: 11131,
        totalTokens: 590419,
      },
    });
  });

  it("codex: turn.completed usage (thread total, input includes cached) is cumulative", () => {
    expect(
      readResultUsage({
        type: "result",
        usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50 },
      }),
    ).toEqual({
      cumulative: true,
      usage: { inputTokens: 1000, cachedInputTokens: 600, outputTokens: 50, totalTokens: 1050 },
    });
  });

  it("claude-shaped usage without modelUsage is a per-turn report (cache tokens added to input)", () => {
    expect(
      readResultUsage({
        type: "result",
        usage: {
          input_tokens: 4,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 20,
          output_tokens: 7,
        },
      }),
    ).toEqual({
      cumulative: false,
      usage: { inputTokens: 124, cachedInputTokens: 100, outputTokens: 7, totalTokens: 131 },
    });
    expect(
      readResultUsage({ type: "result", usage: { input_tokens: 3, output_tokens: 2 } }),
    ).toEqual({
      cumulative: false,
      usage: { inputTokens: 3, cachedInputTokens: null, outputTokens: 2, totalTokens: 5 },
    });
  });

  it("no usage, or no usable numbers, is null (never invented)", () => {
    expect(readResultUsage({ type: "result", result: "done" })).toBe(null);
    expect(readResultUsage({ type: "result", usage: {} })).toBe(null);
    expect(readResultUsage({ type: "result", usage: { input_tokens: "12" } })).toBe(null);
    expect(
      readResultUsage({ type: "result", usage: { input_tokens: -1, output_tokens: 2.5 } }),
    ).toBe(null);
    expect(readResultUsage({ type: "result", modelUsage: { m: { costUSD: 1 } } })).toBe(null);
    expect(readResultUsage({ type: "result", modelUsage: [] })).toBe(null);
  });
});

const u = (input: number, output: number, cached: number | null = null) => ({
  inputTokens: input,
  cachedInputTokens: cached,
  outputTokens: output,
  totalTokens: input + output,
});

describe("UsageTally", () => {
  it("is null until a report arrives", () => {
    expect(new UsageTally().total()).toBe(null);
    const t = new UsageTally();
    t.note("s", null);
    expect(t.total()).toBe(null);
  });

  it("a later cumulative report for the same session replaces the earlier one", () => {
    const t = new UsageTally();
    t.note("s", { cumulative: true, usage: u(100, 10, 50) });
    t.note("s", { cumulative: true, usage: u(300, 30, 200) });
    expect(t.total()).toEqual(u(300, 30, 200));
  });

  it("per-turn reports for one session add up; distinct sessions add up", () => {
    const t = new UsageTally();
    t.note("a", { cumulative: false, usage: u(10, 1) });
    t.note("a", { cumulative: false, usage: u(20, 2, 5) });
    t.note("b", { cumulative: true, usage: u(100, 10, 40) });
    expect(t.total()).toEqual(u(130, 13, 45));
  });

  it("a session keeps one source: a cumulative report wins over per-turn ones", () => {
    const t = new UsageTally();
    t.note("s", { cumulative: false, usage: u(10, 1) });
    t.note("s", { cumulative: true, usage: u(500, 50) });
    t.note("s", { cumulative: false, usage: u(10, 1) });
    expect(t.total()).toEqual(u(500, 50));
  });

  it("merge applies the other tally's reports in order (a resumed codex thread keeps the last)", () => {
    const first = new UsageTally();
    first.note("thread", { cumulative: true, usage: u(100, 10, 0) });
    const resumed = new UsageTally();
    resumed.note("thread", { cumulative: true, usage: u(250, 25, 90) });
    const run = new UsageTally();
    run.merge(first);
    run.merge(resumed);
    expect(run.total()).toEqual(u(250, 25, 90));
  });
});

describe("sumUsage", () => {
  it("sums two reports and keeps null only when both are null", () => {
    expect(sumUsage(null, null)).toBe(null);
    expect(sumUsage(u(1, 2), null)).toEqual(u(1, 2));
    expect(sumUsage(null, u(1, 2, 1))).toEqual(u(1, 2, 1));
    expect(sumUsage(u(1, 2), u(3, 4, 2))).toEqual(u(4, 6, 2));
    expect(sumUsage(u(1, 2), u(3, 4))).toEqual(u(4, 6));
  });
});
