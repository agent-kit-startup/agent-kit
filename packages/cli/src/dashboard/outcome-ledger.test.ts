// Outcome ledger (dashboard/lib/outcome-ledger.mjs), ADR 2026-10-23
// colony-game-canon-outcome-ledger-art-policy points 2-6: replay idempotence,
// event identity, the never-rewarded signals, the flow signal and the
// test-result collector. The snapshot wiring is covered in
// dashboard-data-snapshot.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendTestResult,
  deriveFlowSignal,
  emptyOutcomeLedger,
  extractOutcomeEvents,
  foldOutcomeLedger,
  fullReviewHeadSha,
  isFoldableOutcomeLedger,
  MAX_RECENT_ENTRIES,
  MAX_TEST_RESULTS,
  OUTCOME_LEDGER_REL,
  parseOutcomeLedger,
  parsePlanTodos,
  persistOutcomeLedger,
  readOutcomeLedgerFile,
  readProfileTestCommands,
  readTestResults,
  runAndRecordTests,
  serializeOutcomeLedger,
  summarizeOutcomeLedger,
  TEST_RESULTS_REL,
} from "../../../../dashboard/lib/outcome-ledger.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function sampleInputs() {
  return {
    plans: [
      {
        file: "alpha.plan.md",
        todos: [
          { id: "a1", status: "completed" },
          { id: "a2", status: "completed" },
        ],
      },
      {
        file: "beta.plan.md",
        todos: [
          { id: "b1", status: "completed" },
          { id: "b2", status: "pending" },
        ],
      },
    ],
    timing: {
      missions: {
        "alpha.plan.md": {
          stages: {
            a1: { startedAt: "2026-10-01T10:00:00Z", endedAt: "2026-10-01T11:00:00Z" },
            a2: { startedAt: "2026-10-01T11:00:00Z", endedAt: "2026-10-01T12:00:00Z" },
          },
        },
      },
    },
    reviews: [
      {
        file: "plan-monitor-alpha.md",
        reviewedPlanFile: "alpha.plan.md",
        hasOpenReviewGaps: false,
        fullReviewHead: "abcdef1",
      },
    ],
    tags: [{ name: "v1.0.0", date: "2026-10-02" }],
    ciRuns: [
      { id: 101, conclusion: "success", workflow: "CI", createdAt: "2026-10-02T00:00:00Z" },
      { id: 102, conclusion: "failure", workflow: "CI", createdAt: "2026-10-02T00:01:00Z" },
    ],
    originRelease: { tag: "v1.0.0", publishedAt: "2026-10-02T01:00:00Z" },
    testResults: {
      runs: [
        { at: "2026-10-01T10:30:00Z", ok: false, head: HEAD },
        { at: "2026-10-01T10:40:00Z", ok: true, head: HEAD },
      ],
    },
  };
}

function fold(prev: unknown, inputs: Record<string, unknown>) {
  return foldOutcomeLedger(prev, extractOutcomeEvents(inputs)).ledger;
}

describe("outcome ledger fold", () => {
  it("earns one entry per event identity across every source", () => {
    const ledger = fold(emptyOutcomeLedger(), sampleInputs());
    expect(Object.keys(ledger.entries).sort()).toEqual([
      "ci:101",
      "plan:alpha.plan.md",
      "release-cut:v1.0.0",
      "release-published:v1.0.0",
      "review:plan-monitor-alpha.md:abcdef1",
      `test:${HEAD}`,
      "todo:alpha.plan.md:a1",
      "todo:alpha.plan.md:a2",
      "todo:beta.plan.md:b1",
    ]);
    const summary = summarizeOutcomeLedger(ledger);
    expect(summary.totals).toEqual({ logic: 4, compute: 2, rare: 3 });
    expect(ledger.entries["todo:alpha.plan.md:a2"].at).toBe("2026-10-01T12:00:00Z");
    expect(ledger.entries["plan:alpha.plan.md"].at).toBe("2026-10-01T12:00:00Z");
  });

  it("replaying the same history yields the same ledger, byte for byte", () => {
    const once = fold(emptyOutcomeLedger(), sampleInputs());
    const twice = fold(once, sampleInputs());
    expect(twice).toEqual(once);
    expect(serializeOutcomeLedger(twice)).toBe(serializeOutcomeLedger(once));
    // Order of sources does not matter either.
    const reversed = foldOutcomeLedger(
      emptyOutcomeLedger(),
      extractOutcomeEvents(sampleInputs()).reverse(),
    ).ledger;
    expect(serializeOutcomeLedger(reversed)).toBe(serializeOutcomeLedger(once));
  });

  it("a pruned source never takes an earned entry back", () => {
    const earned = fold(emptyOutcomeLedger(), sampleInputs());
    const after = fold(earned, {});
    expect(after.entries).toEqual(earned.entries);
  });

  it("re-opening and re-closing a to-do earns nothing new", () => {
    const inputs = sampleInputs();
    const earned = fold(emptyOutcomeLedger(), inputs);
    const reopened = structuredClone(inputs);
    reopened.plans[0].todos[0].status = "in_progress";
    const mid = fold(earned, reopened);
    const reclosed = structuredClone(inputs);
    reclosed.timing.missions["alpha.plan.md"].stages.a1.endedAt = "2026-10-09T00:00:00Z";
    const { ledger, added } = foldOutcomeLedger(mid, extractOutcomeEvents(reclosed));
    expect(added).toBe(0);
    expect(ledger.entries["todo:alpha.plan.md:a1"].at).toBe("2026-10-01T11:00:00Z");
  });

  it("many commits and no completed to-dos, tests or CI earn nothing rare (plan Acceptance)", () => {
    // Commits, diff size, lines of code, ticks and tokens are not inputs at all:
    // passing them changes nothing.
    const noise = {
      commits: Array.from({ length: 500 }, (_, i) => ({ sha: `c${i}`, additions: 1000 })),
      linesOfCode: 1_000_000,
      tokens: 9_999_999,
      ticks: 300,
      plans: [{ file: "busy.plan.md", todos: [{ id: "x", status: "in_progress" }] }],
      ciRuns: [{ id: 7, conclusion: "failure" }],
      testResults: { runs: [{ at: "2026-10-01T00:00:00Z", ok: false, head: HEAD }] },
    };
    const ledger = fold(emptyOutcomeLedger(), noise);
    expect(Object.keys(ledger.entries)).toEqual([]);
    expect(summarizeOutcomeLedger(ledger).totals.rare).toBe(0);
  });

  it("a plan with an open-gap review is not closed with zero residuals", () => {
    const inputs = sampleInputs();
    inputs.reviews = [
      {
        file: "plan-monitor-alpha.md",
        reviewedPlanFile: "alpha.plan.md",
        hasOpenReviewGaps: true,
        fullReviewHead: "abcdef1",
      },
    ];
    const keys = Object.keys(fold(emptyOutcomeLedger(), inputs).entries);
    expect(keys).not.toContain("plan:alpha.plan.md");
    expect(keys.some((k) => k.startsWith("review:"))).toBe(false);
  });

  it("a monitor log without a full-review HEAD is not a review outcome", () => {
    const inputs = sampleInputs();
    inputs.reviews[0].fullReviewHead = null as unknown as string;
    const keys = Object.keys(fold(emptyOutcomeLedger(), inputs).entries);
    expect(keys.some((k) => k.startsWith("review:"))).toBe(false);
    expect(
      fullReviewHeadSha(
        "# Monitor\n\n## Full review — plan termination (2026-10-01 10:00, HEAD `abc1234`)\n\n## Full review — plan termination (2026-10-02 10:00, HEAD `def5678`)\n",
      ),
    ).toBe("def5678");
    expect(fullReviewHeadSha("## Tick 0\n**Verdict: PASS**")).toBeNull();
    expect(
      fullReviewHeadSha("## Full review — plan termination (2026-10-01, `HEAD` `abc1234`)"),
    ).toBe("abc1234");
    expect(fullReviewHeadSha("## Full review (current HEAD at 0123abcd)")).toBe("0123abcd");
  });

  it("skips scheduled CI runs, other repos' history runs, and plans when reviews were not read", () => {
    const keys = Object.keys(
      fold(emptyOutcomeLedger(), {
        ciRuns: [
          { id: 1, conclusion: "success", event: "schedule" },
          { id: 2, conclusion: "success", event: "push" },
        ],
        historyRepo: "org/private",
        historyLedger: {
          sections: {
            workflowRuns: {
              columns: ["databaseId", "conclusion", "event", "repository"],
              rows: [
                [3, "success", "push", "org/public"],
                [4, "success", "push", "org/private"],
                [5, "success", "schedule", "org/private"],
              ],
            },
          },
        },
        plans: [{ file: "done.plan.md", todos: [{ id: "a", status: "completed" }] }],
        reviewsCollected: false,
      }).entries,
    ).sort();
    expect(keys).toEqual(["ci:2", "ci:4", "todo:done.plan.md:a"]);
  });

  it("fills a missing time once and never moves a set one", () => {
    const first = foldOutcomeLedger(emptyOutcomeLedger(), [
      {
        key: "release-cut:v1.0.0",
        kind: "releaseCut",
        resource: "compute",
        at: null,
        label: "v1.0.0",
      },
    ]).ledger;
    const filled = foldOutcomeLedger(first, [
      {
        key: "release-cut:v1.0.0",
        kind: "releaseCut",
        resource: "compute",
        at: "2026-10-01",
        label: "v1.0.0",
      },
    ]);
    expect(filled.added).toBe(0);
    expect(filled.ledger.entries["release-cut:v1.0.0"].at).toBe("2026-10-01");
    const moved = foldOutcomeLedger(filled.ledger, [
      {
        key: "release-cut:v1.0.0",
        kind: "releaseCut",
        resource: "compute",
        at: "2026-10-09",
        label: "v1.0.0",
      },
    ]).ledger;
    expect(moved.entries["release-cut:v1.0.0"].at).toBe("2026-10-01");
  });

  it("rejects unsafe keys, bad tags and non-numeric run ids", () => {
    const ledger = fold(emptyOutcomeLedger(), {
      plans: [{ file: "../evil.plan.md", todos: [{ id: "x", status: "completed" }] }],
      tags: [{ name: "v1;rm -rf" }, { name: "release-1" }],
      ciRuns: [{ id: "12; echo", conclusion: "success" }],
      originRelease: { tag: "v2.0.0", publishedAt: null },
      testResults: { runs: [{ at: "2026-10-01T00:00:00Z", ok: true, head: "not-a-sha" }] },
    });
    expect(Object.keys(ledger.entries)).toEqual([]);
  });

  it("the optional factory history ledger adds releases and passing runs, deduped by key", () => {
    const history = {
      sections: {
        releases: {
          columns: ["tagName", "publishedAt"],
          rows: [
            ["v1.0.0", "2026-10-02T01:00:00Z"],
            ["v0.9.0", "2026-09-01T00:00:00Z"],
          ],
        },
        workflowRuns: {
          columns: ["databaseId", "conclusion", "createdAt"],
          rows: [
            [101, "success", "2026-10-02T00:00:00Z"],
            [55, "failure", "2026-09-01T00:00:00Z"],
          ],
        },
      },
    };
    const ledger = fold(emptyOutcomeLedger(), { ...sampleInputs(), historyLedger: history });
    const keys = Object.keys(ledger.entries);
    expect(keys.filter((k) => k.startsWith("release-published:")).sort()).toEqual([
      "release-published:v0.9.0",
      "release-published:v1.0.0",
    ]);
    expect(keys.filter((k) => k.startsWith("ci:"))).toEqual(["ci:101"]);
  });

  it("parses malformed files to an empty ledger and keeps unknown kinds uncounted", () => {
    expect(parseOutcomeLedger(null)).toEqual(emptyOutcomeLedger());
    expect(parseOutcomeLedger({ version: 2, entries: {} })).toEqual(emptyOutcomeLedger());
    const parsed = parseOutcomeLedger({
      version: 1,
      entries: {
        "todo:a.plan.md:x": { kind: "todo", at: "2026-10-01T00:00:00Z", label: "a" },
        "loc:999": { kind: "linesOfCode", at: null, label: "bloat" },
      },
    });
    // A kind from a newer engine survives a round trip and is not counted.
    expect(Object.keys(parsed.entries)).toEqual(["todo:a.plan.md:x", "loc:999"]);
    expect(parsed.entries["todo:a.plan.md:x"].resource).toBe("logic");
    expect(parsed.entries["loc:999"].resource).toBeNull();
    expect(
      Object.keys(parseOutcomeLedger(JSON.parse(serializeOutcomeLedger(parsed))).entries),
    ).toContain("loc:999");
    const summary = summarizeOutcomeLedger(parsed);
    expect(summary.entries).toBe(1);
    expect(summary.totals).toEqual({ logic: 1, compute: 0, rare: 0 });
    expect(isFoldableOutcomeLedger({ version: 2, entries: {} })).toBe(false);
    expect(isFoldableOutcomeLedger(undefined)).toBe(true);
  });

  it("never overwrites an unreadable ledger or one of another version", () => {
    const root = mkdtempSync(join(tmpdir(), "ak-outcome-ledger-v2-"));
    mkdirSync(join(root, ".cursor", "context"), { recursive: true });
    const path = join(root, OUTCOME_LEDGER_REL);
    writeFileSync(path, "{ not json");
    expect(readOutcomeLedgerFile(root).foldable).toBe(false);
    writeFileSync(path, JSON.stringify({ version: 2, entries: { "x:1": { kind: "x" } } }));
    expect(readOutcomeLedgerFile(root).foldable).toBe(false);
    expect(readOutcomeLedgerFile(join(root, "missing")).foldable).toBe(true);
  });

  it("summary caps recent entries, newest first", () => {
    const plans = [
      {
        file: "many.plan.md",
        todos: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, status: "completed" })),
      },
    ];
    const stages = Object.fromEntries(
      plans[0].todos.map((t, i) => [
        t.id,
        {
          startedAt: "2026-10-01T00:00:00Z",
          endedAt: `2026-10-01T00:${String(i).padStart(2, "0")}:00Z`,
        },
      ]),
    );
    const ledger = fold(emptyOutcomeLedger(), {
      plans,
      timing: { missions: { "many.plan.md": { stages } } },
    });
    const summary = summarizeOutcomeLedger(ledger);
    expect(summary.recent).toHaveLength(MAX_RECENT_ENTRIES);
    expect(summary.recent[0].key).toBe("plan:many.plan.md");
    expect(summary.recent[1].key).toBe("todo:many.plan.md:t29");
  });

  it("parses plan frontmatter to-dos", () => {
    expect(
      parsePlanTodos(
        '---\nname: "X"\ntodos:\n  - id: a\n    content: "A"\n    status: completed\n  - id: b\n    content: "B"\n    status: pending\n---\n',
      ),
    ).toEqual([
      { id: "a", status: "completed" },
      { id: "b", status: "pending" },
    ]);
    expect(parsePlanTodos("no frontmatter")).toEqual([]);
  });
});

describe("flow signal", () => {
  const timing = {
    missions: {
      "old.plan.md": {
        stages: { o1: { startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-09-01T01:00:00Z" } },
      },
      "live.plan.md": {
        stages: {
          l1: { startedAt: "2026-10-01T10:00:00Z", endedAt: "2026-10-01T10:30:00Z" },
          l2: { startedAt: "2026-10-01T10:30:00Z", endedAt: "2026-10-01T11:00:00Z" },
          l3: { startedAt: "2026-10-01T11:00:00Z", endedAt: "2026-10-01T11:30:00Z" },
          l4: { startedAt: "2026-10-01T11:30:00Z", endedAt: null },
        },
      },
    },
  };

  it("counts consecutive closes in the most recent mission", () => {
    expect(deriveFlowSignal(timing, [])).toEqual({
      plan: "live.plan.md",
      streak: 3,
      lastClosedAt: "2026-10-01T11:30:00Z",
      brokenAt: null,
    });
  });

  it("a failed or gated tick between closes breaks the streak", () => {
    const logs = [
      { kind: "tick", updatedAt: "2026-10-01T10:45:00.000Z", result: { isError: true }, gates: [] },
    ];
    // Broken between l1 and l2: the streak is l2 + l3.
    expect(deriveFlowSignal(timing, logs)).toMatchObject({
      streak: 2,
      brokenAt: "2026-10-01T10:45:00.000Z",
    });
    const gated = [{ kind: "tick", updatedAt: "2026-10-01T11:15:00.000Z", gates: ["x"] }];
    expect(deriveFlowSignal(timing, gated)?.streak).toBe(1);
  });

  it("a stop after the last close resets it; the exhausted-plan stop does not", () => {
    const stopped = [
      {
        kind: "tick",
        updatedAt: "2026-10-01T12:00:00.000Z",
        gates: [],
        sentinel: "LOOP_TICK_RESULT: stop — blocked on CI",
      },
    ];
    expect(deriveFlowSignal(timing, stopped)?.streak).toBe(0);
    const exhausted = [{ ...stopped[0], sentinel: "LOOP_TICK_RESULT: stop — plan exhausted" }];
    expect(deriveFlowSignal(timing, exhausted)?.streak).toBe(3);
    const run = [{ ...stopped[0], kind: "run" }];
    expect(deriveFlowSignal(timing, run)?.streak).toBe(3);
  });

  it("counts only stages whose to-do is completed when plans are given", () => {
    const plans = [
      {
        file: "live.plan.md",
        todos: [
          { id: "l1", status: "completed" },
          { id: "l2", status: "pending" },
          { id: "l3", status: "completed" },
        ],
      },
    ];
    expect(deriveFlowSignal(timing, [], plans)?.streak).toBe(2);
    const completedWord = [
      {
        kind: "tick",
        updatedAt: "2026-10-01T12:00:00.000Z",
        gates: [],
        sentinel: "LOOP_TICK_RESULT: stop — to-do completed but CI red",
      },
    ];
    expect(deriveFlowSignal(timing, completedWord)?.streak).toBe(0);
  });

  it("ignores frozen missions and returns null with no closes", () => {
    expect(deriveFlowSignal({ missions: {} }, [])).toBeNull();
    expect(deriveFlowSignal(null, [])).toBeNull();
    const frozen = {
      missions: {
        "f.plan.md": {
          frozenAt: "2026-10-01T00:00:00Z",
          stages: { a: { startedAt: "2026-10-01T00:00:00Z", endedAt: "2026-10-01T00:10:00Z" } },
        },
      },
    };
    expect(deriveFlowSignal(frozen, [])).toBeNull();
  });
});

describe("ledger and test-result files", () => {
  function scratch() {
    return mkdtempSync(join(tmpdir(), "ak-outcome-ledger-"));
  }

  it("writes only on change and leaves no file for an empty ledger", () => {
    const root = scratch();
    expect(persistOutcomeLedger(root, emptyOutcomeLedger())).toBe(false);
    expect(existsSync(join(root, OUTCOME_LEDGER_REL))).toBe(false);
    const ledger = fold(emptyOutcomeLedger(), sampleInputs());
    expect(persistOutcomeLedger(root, ledger)).toBe(true);
    expect(persistOutcomeLedger(root, ledger)).toBe(false);
    const onDisk = JSON.parse(readFileSync(join(root, OUTCOME_LEDGER_REL), "utf8"));
    expect(parseOutcomeLedger(onDisk)).toEqual(parseOutcomeLedger(ledger));
  });

  it("keeps folded-source fingerprints so a bulk source is parsed once", () => {
    const { ledger } = foldOutcomeLedger(emptyOutcomeLedger(), [], {
      historyLedger: "10674008-1792866153487",
    });
    expect(parseOutcomeLedger(JSON.parse(serializeOutcomeLedger(ledger))).sources).toEqual({
      historyLedger: "10674008-1792866153487",
    });
  });

  it("reads test commands only from the repository profile", () => {
    const root = scratch();
    expect(readProfileTestCommands(root)).toEqual([]);
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "agent-kit.config.json"),
      JSON.stringify({ stack: { language: "typescript", testCommands: ["pnpm test", 3, ""] } }),
    );
    expect(readProfileTestCommands(root)).toEqual(["pnpm test"]);
  });

  it("records pass/fail by HEAD, stops at the first failing command, and caps history", () => {
    const root = scratch();
    expect(runAndRecordTests(root, { commands: [] })).toEqual({ status: "no-commands" });
    expect(existsSync(join(root, TEST_RESULTS_REL))).toBe(false);

    const calls: string[] = [];
    const spawn = (cmd: unknown, ...rest: unknown[]) => {
      if (cmd === "git") return { status: 0, stdout: `${HEAD}\n` };
      calls.push(String(cmd));
      void rest;
      return { status: cmd === "fail" ? 3 : 0 };
    };
    const now = new Date("2026-10-24T10:00:00.000Z");
    const failed = runAndRecordTests(root, { commands: ["ok", "fail", "never"], spawn, now });
    expect(calls).toEqual(["ok", "fail"]);
    expect(failed).toMatchObject({
      status: "recorded",
      run: { ok: false, exitCode: 3, head: HEAD },
    });
    const passed = runAndRecordTests(root, { commands: ["ok"], spawn, now });
    expect(passed).toMatchObject({ run: { ok: true, exitCode: 0 } });
    expect(readTestResults(root).runs.map((r) => r.ok)).toEqual([false, true]);

    for (let i = 0; i < MAX_TEST_RESULTS + 5; i += 1) {
      appendTestResult(root, {
        at: now.toISOString(),
        ok: true,
        exitCode: 0,
        head: HEAD,
        commands: [],
      });
    }
    expect(readTestResults(root).runs).toHaveLength(MAX_TEST_RESULTS);
    // Running the suite many times at one HEAD still earns one Logic.
    const ledger = fold(emptyOutcomeLedger(), { testResults: readTestResults(root) });
    expect(Object.keys(ledger.entries)).toEqual([`test:${HEAD}`]);
  });
});
