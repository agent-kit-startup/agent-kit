import { describe, expect, it } from "vitest";
import {
  BUSY_OUTSIDE_PLAN_FRESH_MS,
  FLIGHT_LOG_LEDGER_REL,
  FLIGHT_LOG_PAST_CAP,
  FLIGHT_LOG_QUIET_OPEN_TRIAGES_CAP,
  FLIGHT_LOG_WARNINGS_CAP,
  MAX_ACTIVITY,
  MAX_INVENTORY_ACTIVITY,
  MAX_SEMANTIC_LABEL,
  MONITOR_ACTIVITY_KINDS,
  MONITOR_AGENT_STEP_EMIT_CAP,
  MONITOR_FEED_CAP,
  allowlistReadinessPending,
  briefActivityActor,
  buildAttentionItems,
  buildBatchExternalReviewPasteCommand,
  buildCadenceAttentionItem,
  buildChecklistNotes,
  buildCurrentExecution,
  buildFlightLogFlightKey,
  buildFlightLogWarnings,
  buildInventoryBaseline,
  buildMissionControlView,
  buildRunQueueView,
  classifyFlightLogMessageKind,
  classifyPlan,
  clearCadenceWarning,
  collectDeferredCheckIds,
  collectReadinessPendingFromReport,
  deliverySupersededShas,
  deriveBusyOutsidePlan,
  describeProcess,
  emptyCadenceLedger,
  emptyFlightLogLedger,
  emptyMissionTimingLedger,
  enrichPlans,
  extractHandoffFieldBlock,
  extractMergeBranch,
  flightLogKindClass,
  formatDeliveryActivity,
  formatGitActivity,
  formatInventoryActivity,
  formatPlanHandoffActivity,
  isFieldReportAttentionId,
  listFlightLogQuietOpenTriages,
  listUnreviewedReviewTargets,
  mergeActivity,
  normalizeHandoffGaps,
  normalizeKitAgentId,
  observeFlightLog,
  observeMissionTiming,
  parseCadenceLedger,
  parseDeliveryCommitType,
  parseExternalReport,
  parseFieldReportReviewCadenceConfig,
  parseFlightLogLedger,
  parseHandoffMarkdown,
  parseMissionTimingLedger,
  parseParkedPlans,
  parseQueueCursor,
  parseQueueOutcomes,
  parseRunQueue,
  planQueueRole,
  recordCadenceBatchComplete,
  recordCadenceTickClose,
  resolveDeliveryAttribution,
  withMissionTiming,
} from "../../../../dashboard/lib/semantic-model.mjs";

const samplePlans = [
  {
    id: "mission-control-plugin-ux",
    file: "mission-control-plugin-ux.plan.md",
    path: ".cursor/plans/mission-control-plugin-ux.plan.md",
    overview: "Plugin UX",
    modifiedAt: "2026-07-24T20:00:00.000Z",
    todos: {
      total: 3,
      completed: 0,
      pending: 2,
      inProgress: 1,
      items: [
        {
          id: "semantic-snapshot-model",
          content: "Build view model",
          status: "in_progress",
        },
        { id: "narrow-plugin-shell", content: "Shell", status: "pending" },
        { id: "now-execution-panel", content: "Now panel", status: "pending" },
      ],
    },
  },
  {
    id: "mission-control-hardening",
    file: "mission-control-hardening.plan.md",
    path: ".cursor/plans/mission-control-hardening.plan.md",
    overview: "Hardening",
    modifiedAt: "2026-07-24T18:00:00.000Z",
    todos: {
      total: 2,
      completed: 2,
      pending: 0,
      inProgress: 0,
      items: [
        { id: "sec-xss", content: "XSS", status: "completed" },
        { id: "sec-cors", content: "CORS", status: "completed" },
      ],
    },
  },
  {
    id: "other-incomplete",
    file: "other-incomplete.plan.md",
    path: ".cursor/plans/other-incomplete.plan.md",
    overview: "Leftover",
    modifiedAt: "2026-07-20T12:00:00.000Z",
    todos: {
      total: 2,
      completed: 1,
      pending: 1,
      inProgress: 0,
      items: [
        { id: "done-a", content: "Done", status: "completed" },
        { id: "open-b", content: "Open", status: "pending" },
      ],
    },
  },
];

describe("parseHandoffMarkdown", () => {
  it("extracts plan, mode, parked plans, and next todos", () => {
    const md = `# Handoff

- **Plan:** \`mission-control-plugin-ux.plan.md\`
- **Last updated:** 2026-07-24 20:13
- **Mode:** run-plan (orchestrated)
- **Phase completed:** 0
- **Completed to-dos:** none
- **Next phase:** 0
- **Next to-dos:** \`semantic-snapshot-model\`
- **Parked plans:** \`mission-control-hardening.plan.md\` (exhausted)
- **Instruction for the next agent:** Run the first unit only.
`;

    const handoff = parseHandoffMarkdown(md);
    expect(handoff).toMatchObject({
      plan: "mission-control-plugin-ux.plan.md",
      planPath: ".cursor/plans/mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      nextTodos: "`semantic-snapshot-model`",
      lastUpdated: "2026-07-24 20:13",
    });
    expect(handoff.parkedPlans).toEqual(["mission-control-hardening.plan.md"]);
    expect(handoff.backlogPlans).toEqual([]);
    expect(handoff.gaps).toBeUndefined();
  });

  it("parses HANDOFF Gaps and normalizes none/n/a to absent", () => {
    const withGaps = parseHandoffMarkdown(`# Handoff
- **Plan:** \`api-limit.plan.md\`
- **Mode:** run-plan (orchestrated) — STOPPED: API/usage limit
- **Gaps:** API/usage limit; cursor on mc-gaps-surface; resume after named model
- **Instruction for the next agent:** Wait for quota reset.
`);
    expect(withGaps?.gaps).toBe(
      "API/usage limit; cursor on mc-gaps-surface; resume after named model",
    );

    const noneGaps = parseHandoffMarkdown(`# Handoff
- **Plan:** \`api-limit.plan.md\`
- **Gaps:** none
`);
    expect(noneGaps?.gaps).toBeUndefined();

    expect(normalizeHandoffGaps("none")).toBeNull();
    expect(normalizeHandoffGaps("n/a")).toBeNull();
    expect(normalizeHandoffGaps("  ")).toBeNull();
    expect(normalizeHandoffGaps("none. Residuals parked; see Instruction")).toBeNull();
    expect(normalizeHandoffGaps("none: mid-batch audit deferred")).toBeNull();
    expect(normalizeHandoffGaps("n/a - queue plumbing only")).toBeNull();
    expect(normalizeHandoffGaps("None. Residuals parked; see Instruction")).toBeNull();
    expect(normalizeHandoffGaps("N/A - queue plumbing only")).toBeNull();
    expect(normalizeHandoffGaps("none (audits are not Gaps)")).toBeNull();
    expect(normalizeHandoffGaps("none; see Instruction")).toBeNull();
    expect(normalizeHandoffGaps("none/see Instruction")).toBeNull();
    expect(normalizeHandoffGaps("All clear")).toBeNull();
    expect(normalizeHandoffGaps("—")).toBeNull();
    expect(normalizeHandoffGaps("Blocked on secrets review")).toBe("Blocked on secrets review");
    expect(classifyFlightLogMessageKind(null)).toBe("ok");
    expect(classifyFlightLogMessageKind("none. Residuals…")).toBe("ok");
    expect(classifyFlightLogMessageKind("None. Residuals parked")).toBe("ok");
    expect(classifyFlightLogMessageKind("N/A - queue only")).toBe("ok");
    expect(classifyFlightLogMessageKind("Enqueue residuals for F1")).toBe("residual");
    expect(classifyFlightLogMessageKind("Tip: prefer named model for continuous runs")).toBe(
      "advice",
    );
    expect(classifyFlightLogMessageKind("Confirm before merge to main")).toBe("prompt");
    expect(classifyFlightLogMessageKind("API/usage limit; resume after named model")).toBe(
      "warning",
    );
    expect(classifyFlightLogMessageKind("anything", { lane: "warning" })).toBe("warning");
    // Pre-truncation: keyword past MAX_SEMANTIC_LABEL still classifies (F4).
    const longPrefix = "x".repeat(MAX_SEMANTIC_LABEL + 20);
    expect(
      classifyFlightLogMessageKind(`${longPrefix} tip: prefer named model for continuous runs`),
    ).toBe("advice");
    expect(flightLogKindClass("residual")).toBe("flight-log-kind-residual");
    expect(flightLogKindClass("advice")).toBe("flight-log-kind-advice");
    expect(flightLogKindClass("prompt")).toBe("flight-log-kind-advice");
    expect(flightLogKindClass("ok")).toBe("flight-log-kind-ok");
    expect(flightLogKindClass("warning")).toBe("flight-log-kind-warning");
  });

  it("parses nested multi-line Parked/Backlog blocks and rejects backtick noise", () => {
    const md = `# Handoff - Close Mission Control residuals

- **Plan:** \`close-mission-control-residuals.plan.md\`
- **Mode:** run-plan (orchestrated)
- **Next to-dos:** \`handoff-plan-sections\`
- **Staging:**
  - Phase 4: PR #263 on \`origin/staging\`
  - Prior: #257
- **Backlog plans:**
  - \`refresh-icon-button.plan.md\` (approved at Gate A, not started)
- **Parked plans:**
  - \`dashboard-field-report-and-skins.plan.md\` (exhausted; PRs on \`origin/staging\`; monitor: \`.cursor/memory/plan-monitor-dashboard-field-report-and-skins.md\`)
  - \`close-24h-monitor-residuals.plan.md\` (exhausted)
  - \`24h-full-review-and-fix.plan.md\` (exhausted)
  - \`public-sync-dashboard-allowlist.plan.md\` (exhausted)
- **Gaps:** none
- **Instruction for the next agent:** Continue.
`;

    const handoff = parseHandoffMarkdown(md);
    expect(handoff.backlogPlans).toEqual(["refresh-icon-button.plan.md"]);
    expect(handoff.parkedPlans).toEqual([
      "dashboard-field-report-and-skins.plan.md",
      "close-24h-monitor-residuals.plan.md",
      "24h-full-review-and-fix.plan.md",
      "public-sync-dashboard-allowlist.plan.md",
    ]);
    expect(handoff.parkedPlans).not.toContain("staging");
    expect(handoff.parkedPlans.join(" ")).not.toMatch(/plan-monitor/);
    // Raw may still mention branches/monitors; only parsed refs must stay clean.
    expect(handoff.parkedPlansRaw).toMatch(/origin\/staging/);
    // Gaps: none must not surface as a string on the parsed handoff.
    expect(handoff.gaps).toBeUndefined();
  });
  it("falls back to Backlog (short label) when Backlog plans is absent", () => {
    const md = `# Handoff

- **Plan:** \`some-plan.plan.md\`
- **Mode:** run-plan
- **Backlog:**
  - \`short-label-plan.plan.md\`
- **Parked plans:** \`parked.plan.md\`
- **Instruction:** Continue.
`;

    const handoff = parseHandoffMarkdown(md);
    expect(handoff.backlogPlans).toEqual(["short-label-plan.plan.md"]);
  });

  it("accepts plain (no-backtick) Plan refs and rejects none placeholders", () => {
    const plain = parseHandoffMarkdown(
      "- **Plan:** live-queue.plan.md\n- **Mode:** run-plan-all\n",
    );
    expect(plain?.plan).toBe("live-queue.plan.md");
    expect(plain?.planPath).toBe(".cursor/plans/live-queue.plan.md");

    const none = parseHandoffMarkdown(
      "- **Plan:** none (queue exhausted)\n- **Mode:** run-plan-all\n",
    );
    expect(none?.plan).toBeUndefined();

    const na = parseHandoffMarkdown("- **Plan:** n/a\n");
    expect(na?.plan).toBeUndefined();
  });

  it("parses ## Backlog plans / ## Parked plans heading antipattern", () => {
    const md = `# Handoff - broken writer shape

- **Plan:** none
- **Mode:** run-plan-all

## Backlog plans

- \`checklist-plan-actions-dropdown.plan.md\`

## Parked plans

- \`old-parked.plan.md\` (exhausted)
`;

    const handoff = parseHandoffMarkdown(md);
    expect(handoff.plan).toBeUndefined();
    expect(handoff.backlogPlans).toEqual(["checklist-plan-actions-dropdown.plan.md"]);
    expect(handoff.parkedPlans).toEqual(["old-parked.plan.md"]);
  });
});

describe("extractHandoffFieldBlock", () => {
  it("consumes nested bullets until the next top-level field", () => {
    const md = `- **Parked plans:**
  - \`a.plan.md\`
  - \`b.plan.md\`
- **Gaps:** none
`;
    expect(extractHandoffFieldBlock(md, "Parked plans")).toContain("a.plan.md");
    expect(extractHandoffFieldBlock(md, "Parked plans")).toContain("b.plan.md");
    expect(extractHandoffFieldBlock(md, "Parked plans")).not.toContain("Gaps");
  });
});

describe("parseParkedPlans", () => {
  it("parses backtick and comma forms", () => {
    expect(parseParkedPlans("`a.plan.md` (note); `b.plan.md`")).toEqual(["a.plan.md", "b.plan.md"]);
    expect(parseParkedPlans("none")).toEqual([]);
  });

  it("keeps only *.plan.md refs and drops branch/monitor noise", () => {
    expect(
      parseParkedPlans(
        "`a.plan.md` (note; on `origin/staging`; monitor: `.cursor/memory/plan-monitor-x.md`)",
      ),
    ).toEqual(["a.plan.md"]);
    expect(parseParkedPlans("`origin/staging`; `notes.md`; `b.plan.md`")).toEqual(["b.plan.md"]);
  });
});

describe("run-plan-all queue parsing", () => {
  // Live dogfood HANDOFF shape (2026-07-26 run-plan-all queue).
  const liveQueueHandoff = `# Handoff - run-plan-all queue (shimmer → residuals → cockpit)

- **Plan:** \`cockpit-run-plan-all-queue.plan.md\`
- **Last updated:** 2026-07-26 13:49
- **Mode:** run-plan-all
- **Run queue:** [checklist-plans-active-progress-shimmer.plan.md, monitor-feed-single-roll-residuals.plan.md, cockpit-run-plan-all-queue.plan.md]
- **Queue cursor:** 2 (current: cockpit-run-plan-all-queue.plan.md)
- **Queue status:** running
- **Queue outcomes:**
  - checklist-plans-active-progress-shimmer.plan.md: completed (lastTodoId: validate-changelog; PR #338)
  - monitor-feed-single-roll-residuals.plan.md: completed (lastTodoId: validate-changelog-handoff; PR #339)
- **Next to-dos:** adr-queue-cockpit
- **Instruction for the next agent:** Cursor 2 is cockpit queue awareness.
`;

  it("parses the live run-plan-all HANDOFF queue slice", () => {
    const handoff = parseHandoffMarkdown(liveQueueHandoff);
    expect(handoff).not.toBeNull();
    expect(handoff.mode).toBe("run-plan-all");
    expect(handoff.runQueue).toEqual([
      "checklist-plans-active-progress-shimmer.plan.md",
      "monitor-feed-single-roll-residuals.plan.md",
      "cockpit-run-plan-all-queue.plan.md",
    ]);
    expect(handoff.queueCursor).toBe(2);
    expect(handoff.queueCursorPlan).toBe("cockpit-run-plan-all-queue.plan.md");
    expect(handoff.queueStatus).toBe("running");
    expect(handoff.queueOutcomes).toEqual({
      "checklist-plans-active-progress-shimmer.plan.md": "completed",
      "monitor-feed-single-roll-residuals.plan.md": "completed",
    });
  });

  it("defaults queue fields when the HANDOFF has no queue slice", () => {
    const handoff = parseHandoffMarkdown(
      "- **Plan:** `single.plan.md`\n- **Mode:** run-plan (orchestrated)\n",
    );
    expect(handoff.runQueue).toEqual([]);
    expect(handoff.queueCursor).toBeNull();
    expect(handoff.queueCursorPlan).toBeNull();
    expect(handoff.queueStatus).toBeUndefined();
    expect(handoff.queueOutcomes).toEqual({});
  });

  it("parseRunQueue keeps order, accepts backticks/bullets, rejects noise", () => {
    expect(parseRunQueue("[a.plan.md, b.plan.md, c.plan.md]")).toEqual([
      "a.plan.md",
      "b.plan.md",
      "c.plan.md",
    ]);
    expect(parseRunQueue("- `b.plan.md` (queued)\n- `a.plan.md`")).toEqual([
      "b.plan.md",
      "a.plan.md",
    ]);
    expect(parseRunQueue("[`origin/staging`, notes.md, a.plan.md, a.plan.md]")).toEqual([
      "a.plan.md",
    ]);
    expect(parseRunQueue("none")).toEqual([]);
    expect(parseRunQueue("")).toEqual([]);
  });

  it("parseQueueCursor extracts index and exact current basename only", () => {
    expect(parseQueueCursor("2 (current: cockpit.plan.md)")).toEqual({
      index: 2,
      plan: "cockpit.plan.md",
    });
    expect(parseQueueCursor("0")).toEqual({ index: 0, plan: null });
    expect(parseQueueCursor("1 (current: origin/staging)")).toEqual({ index: 1, plan: null });
    expect(parseQueueCursor("current only, no index")).toEqual({ index: null, plan: null });
  });

  it("parseQueueOutcomes maps basenames to outcome tokens and skips noise", () => {
    expect(
      parseQueueOutcomes(
        "- a.plan.md: completed (lastTodoId: x; PR #1)\n- b.plan.md: blocked (external dep)\nnot a plan line",
      ),
    ).toEqual({ "a.plan.md": "completed", "b.plan.md": "blocked" });
    expect(parseQueueOutcomes("")).toEqual({});
  });
});

describe("run-plan-all queue view (semantic layer)", () => {
  const queueHandoff = {
    plan: "b.plan.md",
    mode: "run-plan-all",
    runQueue: ["a.plan.md", "b.plan.md", "c.plan.md"],
    queueCursor: 1,
    queueCursorPlan: "b.plan.md",
    queueStatus: "running",
    queueOutcomes: { "a.plan.md": "completed" },
  };

  const queuePlan = (id: string, statuses: string[]) => ({
    id: id.replace(/\.plan\.md$/, ""),
    file: id,
    path: `.cursor/plans/${id}`,
    overview: id,
    modifiedAt: "2026-07-26T12:00:00.000Z",
    todos: {
      total: statuses.length,
      completed: statuses.filter((s) => s === "completed").length,
      pending: statuses.filter((s) => s === "pending").length,
      inProgress: statuses.filter((s) => s === "in_progress").length,
      items: statuses.map((status, i) => ({ id: `t${i}`, content: `step ${i}`, status })),
    },
  });

  it("buildRunQueueView is null outside run-plan-all mode or without a queue", () => {
    expect(buildRunQueueView(null)).toBeNull();
    expect(
      buildRunQueueView({ mode: "run-plan (orchestrated)", runQueue: ["a.plan.md"] }),
    ).toBeNull();
    expect(buildRunQueueView({ mode: "run-plan-all", runQueue: [] })).toBeNull();
  });

  it("resolves cursor and nextUpPlan, skipping terminal outcomes", () => {
    const view = buildRunQueueView(queueHandoff);
    expect(view).toMatchObject({
      queue: ["a.plan.md", "b.plan.md", "c.plan.md"],
      cursor: 1,
      status: "running",
      nextUpPlan: "c.plan.md",
    });
    // Cursor at the last item: nothing after it.
    expect(
      buildRunQueueView({ ...queueHandoff, queueCursor: 2, queueCursorPlan: "c.plan.md" })
        ?.nextUpPlan,
    ).toBeNull();
    // Next item already completed in outcomes is skipped.
    expect(
      buildRunQueueView({
        ...queueHandoff,
        queueCursor: 0,
        queueOutcomes: { "b.plan.md": "completed" },
      })?.nextUpPlan,
    ).toBe("c.plan.md");
  });

  it("falls back to current basename, then active plan, for the cursor", () => {
    expect(buildRunQueueView({ ...queueHandoff, queueCursor: null })?.cursor).toBe(1);
    expect(
      buildRunQueueView({ ...queueHandoff, queueCursor: null, queueCursorPlan: null })?.cursor,
    ).toBe(1);
    expect(
      buildRunQueueView({
        ...queueHandoff,
        plan: "elsewhere.plan.md",
        queueCursor: null,
        queueCursorPlan: null,
      })?.cursor,
    ).toBeNull();
  });

  it("planQueueRole layers executing / next_up / queued / completed_in_queue", () => {
    const fourItemView = buildRunQueueView({
      ...queueHandoff,
      runQueue: ["a.plan.md", "b.plan.md", "c.plan.md", "d.plan.md"],
    });
    expect(fourItemView?.nextUpPlan).toBe("c.plan.md");
    expect(planQueueRole(queuePlan("a.plan.md", ["completed"]), fourItemView)).toBe(
      "completed_in_queue",
    );
    expect(planQueueRole(queuePlan("b.plan.md", ["in_progress"]), fourItemView)).toBe("executing");
    expect(planQueueRole(queuePlan("c.plan.md", ["pending"]), fourItemView)).toBe("next_up");
    expect(planQueueRole(queuePlan("d.plan.md", ["pending"]), fourItemView)).toBe("queued");
    expect(planQueueRole(queuePlan("outside.plan.md", ["pending"]), fourItemView)).toBe("none");
    expect(planQueueRole(queuePlan("c.plan.md", ["pending"]), null)).toBe("none");
  });

  it("buildCurrentExecution exposes nextUpPlan for a terminal active plan", () => {
    const terminalActive = queuePlan("b.plan.md", ["completed", "completed"]);
    const now = buildCurrentExecution([terminalActive], queueHandoff);
    expect(now.status).toBe("completed");
    expect(now.nextUpPlan).toBe("c.plan.md");
    // Single-plan mode: nextUpPlan stays null.
    const single = buildCurrentExecution([terminalActive], {
      plan: "b.plan.md",
      mode: "run-plan (orchestrated)",
    });
    expect(single.nextUpPlan).toBeNull();
  });

  it("enrichPlans stamps queueRole and queueIndex; buildMissionControlView exposes runQueue", () => {
    const plans = [
      queuePlan("a.plan.md", ["completed"]),
      queuePlan("b.plan.md", ["in_progress"]),
      queuePlan("c.plan.md", ["pending"]),
      queuePlan("outside.plan.md", ["pending"]),
    ];
    const enriched = enrichPlans(plans, queueHandoff);
    const byFile = Object.fromEntries(enriched.map((p) => [p.file, p]));
    expect(byFile["a.plan.md"]).toMatchObject({ queueRole: "completed_in_queue", queueIndex: 0 });
    expect(byFile["b.plan.md"]).toMatchObject({ queueRole: "executing", queueIndex: 1 });
    expect(byFile["c.plan.md"]).toMatchObject({ queueRole: "next_up", queueIndex: 2 });
    expect(byFile["outside.plan.md"]).toMatchObject({ queueRole: "none", queueIndex: null });

    const view = buildMissionControlView({ plans, handoff: queueHandoff });
    expect(view.runQueue).toMatchObject({ cursor: 1, nextUpPlan: "c.plan.md" });
    expect(view.now.nextUpPlan).toBe("c.plan.md");

    // Outside queue mode the slice is null and roles are none.
    const singleView = buildMissionControlView({
      plans,
      handoff: { plan: "b.plan.md", mode: "run-plan (orchestrated)" },
    });
    expect(singleView.runQueue).toBeNull();
    expect(singleView.plans.every((p) => p.queueRole === "none" && p.queueIndex === null)).toBe(
      true,
    );
  });
});

/** Parked list entry that still has open todos (decision note stays). */
const parkedOpenPlan = {
  id: "parked-open-work",
  file: "parked-open-work.plan.md",
  path: ".cursor/plans/parked-open-work.plan.md",
  overview: "Parked with open work",
  modifiedAt: "2026-07-22T12:00:00.000Z",
  todos: {
    total: 2,
    completed: 0,
    pending: 2,
    inProgress: 0,
    items: [
      { id: "still-a", content: "A", status: "pending" },
      { id: "still-b", content: "B", status: "pending" },
    ],
  },
};

/** Backlog list entry with open todos (queued by /start-project). */
const backlogOpenPlan = {
  id: "refresh-icon-button",
  file: "refresh-icon-button.plan.md",
  path: ".cursor/plans/refresh-icon-button.plan.md",
  overview: "Queued backlog",
  modifiedAt: "2026-07-25T12:00:00.000Z",
  todos: {
    total: 2,
    completed: 0,
    pending: 2,
    inProgress: 0,
    items: [
      { id: "backlog-a", content: "A", status: "pending" },
      { id: "backlog-b", content: "B", status: "pending" },
    ],
  },
};

/** Backlog entry with zero open todos (mirrors parked → completed). */
const backlogDonePlan = {
  id: "backlog-done",
  file: "backlog-done.plan.md",
  path: ".cursor/plans/backlog-done.plan.md",
  overview: "Backlog empty",
  modifiedAt: "2026-07-25T11:00:00.000Z",
  todos: {
    total: 1,
    completed: 1,
    pending: 0,
    inProgress: 0,
    items: [{ id: "done-only", content: "Done", status: "completed" }],
  },
};

describe("classifyPlan", () => {
  const executingHandoff = {
    plan: "mission-control-plugin-ux.plan.md",
    mode: "run-plan (orchestrated)",
    parkedPlans: ["mission-control-hardening.plan.md", "parked-open-work.plan.md"],
    backlogPlans: ["refresh-icon-button.plan.md", "backlog-done.plan.md"],
    nextTodos: "`semantic-snapshot-model`",
  };

  it("classifies executing, parked, completed, and incomplete", () => {
    expect(classifyPlan(samplePlans[0], executingHandoff)).toBe("executing");
    // Contract change: parked + zero open → completed (was parked).
    expect(classifyPlan(samplePlans[1], executingHandoff)).toBe("completed");
    expect(classifyPlan(parkedOpenPlan, executingHandoff)).toBe("parked");
    expect(
      classifyPlan(samplePlans[1], {
        plan: "mission-control-plugin-ux.plan.md",
        parkedPlans: [],
      }),
    ).toBe("completed");
    expect(classifyPlan(samplePlans[2], executingHandoff)).toBe("incomplete");
  });

  it("classifies backlog open as backlog (info) and zero-open as completed", () => {
    expect(classifyPlan(backlogOpenPlan, executingHandoff)).toBe("backlog");
    expect(classifyPlan(backlogDonePlan, executingHandoff)).toBe("completed");
    // Without backlog listing, never-started open work is backlog (not incomplete).
    expect(
      classifyPlan(backlogOpenPlan, {
        plan: "mission-control-plugin-ux.plan.md",
        parkedPlans: [],
        backlogPlans: [],
      }),
    ).toBe("backlog");
  });

  it("classifies active plan without in_progress as awaiting_user when mode waits", () => {
    const awaiting = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "START-PROJECT Gate A complete, awaiting Gate B",
      parkedPlans: [],
      nextTodos: "`semantic-snapshot-model`",
    };
    const plan = {
      ...samplePlans[0],
      todos: {
        ...samplePlans[0].todos,
        inProgress: 0,
        pending: 3,
        items: samplePlans[0].todos.items.map((t) => ({
          ...t,
          status: "pending",
        })),
      },
    };
    expect(classifyPlan(plan, awaiting)).toBe("awaiting_user");
  });

  it("treats STOPPED/exhausted + all-terminal active plan as completed (not executing)", () => {
    const donePlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 3,
        pending: 0,
        inProgress: 0,
        items: samplePlans[0].todos.items.map((t) => ({
          ...t,
          status: "completed" as const,
        })),
      },
    };
    const exhausted = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "STOPPED (run-plan orchestrated; plan exhausted)",
      parkedPlans: [],
    };
    expect(classifyPlan(donePlan, exhausted)).toBe("completed");
  });
});

describe("buildCurrentExecution", () => {
  it("matches active plan and exposes current/next todos", () => {
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: ["mission-control-hardening.plan.md"],
      nextTodos: "`semantic-snapshot-model`",
    };
    const now = buildCurrentExecution(samplePlans, handoff);
    expect(now.status).toBe("executing");
    expect(now.progress).toEqual({ completed: 0, total: 3 });
    expect(now.currentTodo?.id).toBe("semantic-snapshot-model");
    expect(now.nextTodo?.id).toBe("narrow-plugin-shell");
    expect(now.planPath).toBe(".cursor/plans/mission-control-plugin-ux.plan.md");
    expect(now.sourcePath).toBe(".cursor/HANDOFF.md");
    expect(now.gaps).toBeNull();
  });

  it("passes HANDOFF Gaps onto the now view and omits when absent", () => {
    const withGaps = buildCurrentExecution(samplePlans, {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated) — STOPPED: API/usage limit",
      gaps: "API/usage limit; resume after named model",
      parkedPlans: [],
      nextTodos: "`semantic-snapshot-model`",
    });
    expect(withGaps.gaps).toBe("API/usage limit; resume after named model");

    const noGaps = buildCurrentExecution(samplePlans, {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
      nextTodos: "`semantic-snapshot-model`",
    });
    expect(noGaps.gaps).toBeNull();
  });

  it("returns idle when HANDOFF has no plan", () => {
    const idle = buildCurrentExecution(samplePlans, null);
    expect(idle.status).toBe("idle");
    expect(idle.previousTodo).toBeNull();
  });

  /**
   * Completed mission presentation contract (Phase 0):
   * exhausted terminal plans keep Current mission identity + N/N progress;
   * true idle requires no HANDOFF plan reference.
   */
  describe("completed mission presentation contract", () => {
    const terminalPlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 3,
        pending: 0,
        inProgress: 0,
        items: [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" as const },
          { id: "narrow-plugin-shell", content: "Done", status: "completed" as const },
          { id: "now-execution-panel", content: "Done", status: "completed" as const },
        ],
      },
    };

    it("keeps completed status, plan identity, and full N/N progress for exhausted terminal plans", () => {
      const now = buildCurrentExecution([terminalPlan], {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "STOPPED (run-plan orchestrated; plan exhausted)",
        parkedPlans: [],
      });
      expect(now.status).toBe("completed");
      expect(now.lifecycle).toBe("completed");
      expect(now.planId).toBe("mission-control-plugin-ux");
      expect(now.planFile).toBe("mission-control-plugin-ux.plan.md");
      expect(now.planPath).toBe(".cursor/plans/mission-control-plugin-ux.plan.md");
      expect(now.progress).toEqual({ completed: 3, total: 3 });
      expect(now.progress.completed).toBe(now.progress.total);
      expect(now.progress.total).toBeGreaterThan(0);
      expect(now.gaps).toBeNull();
    });

    it("true idle requires no HANDOFF plan reference (null plan fields, 0/0)", () => {
      for (const handoff of [null, undefined, { mode: "STOPPED", parkedPlans: [] }, { plan: "" }]) {
        const idle = buildCurrentExecution(samplePlans, handoff as never);
        expect(idle.status).toBe("idle");
        expect(idle.planId).toBeNull();
        expect(idle.planFile).toBeNull();
        expect(idle.planPath).toBeNull();
        expect(idle.lifecycle).toBeNull();
        expect(idle.progress).toEqual({ completed: 0, total: 0 });
        expect(idle.currentTodo).toBeNull();
        expect(idle.nextTodo).toBeNull();
        expect(idle.previousTodo).toBeNull();
      }
    });

    /**
     * Terminal step semantics (Phase 2): the last completed to-do is the step
     * the panel renders as done, and nothing is left to announce as next.
     */
    it("exposes the last completed to-do as the terminal step with no open work", () => {
      const now = buildCurrentExecution([terminalPlan], {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "STOPPED (run-plan orchestrated; plan exhausted)",
        parkedPlans: [],
      });
      expect(now.previousTodo?.id).toBe("now-execution-panel");
      expect(now.previousTodo?.status).toBe("completed");
      expect(now.currentTodo).toBeNull();
      expect(now.nextTodo).toBeNull();
    });

    it("does not resurrect a terminal to-do named by an exhausted HANDOFF as current work", () => {
      for (const nextTodos of ["`now-execution-panel`", "`now-execution-panel` (completed)"]) {
        const now = buildCurrentExecution([terminalPlan], {
          plan: "mission-control-plugin-ux.plan.md",
          mode: "STOPPED (run-plan orchestrated; plan exhausted)",
          parkedPlans: [],
          nextTodos,
        });
        expect(now.status).toBe("completed");
        expect(now.currentTodo).toBeNull();
        expect(now.nextTodo).toBeNull();
        expect(now.previousTodo?.id).toBe("now-execution-panel");
      }
    });

    it("keeps the last completed to-do terminal when the plan ends on a cancelled to-do", () => {
      const cancelledTail = {
        ...terminalPlan,
        todos: {
          total: 3,
          completed: 2,
          pending: 0,
          inProgress: 0,
          items: [
            { id: "semantic-snapshot-model", content: "Done", status: "completed" as const },
            { id: "narrow-plugin-shell", content: "Done", status: "completed" as const },
            { id: "now-execution-panel", content: "Dropped", status: "cancelled" as const },
          ],
        },
      };
      const now = buildCurrentExecution([cancelledTail], {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "STOPPED (run-plan orchestrated; plan exhausted)",
        parkedPlans: [],
        nextTodos: "`now-execution-panel`",
      });
      expect(now.status).toBe("completed");
      expect(now.previousTodo?.id).toBe("narrow-plugin-shell");
      expect(now.currentTodo).toBeNull();
      expect(now.nextTodo).toBeNull();
    });
  });

  it("derives previousTodo from completed steps and never invents one", () => {
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
    };
    // First step in progress: no source for a previous step.
    expect(buildCurrentExecution(samplePlans, handoff).previousTodo).toBeNull();

    const midPlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 1,
        pending: 1,
        inProgress: 1,
        items: [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" },
          { id: "narrow-plugin-shell", content: "Shell", status: "in_progress" },
          { id: "now-execution-panel", content: "Now panel", status: "pending" },
        ],
      },
    };
    const mid = buildCurrentExecution([midPlan], handoff);
    expect(mid.previousTodo?.id).toBe("semantic-snapshot-model");
    expect(mid.currentTodo?.id).toBe("narrow-plugin-shell");
    expect(mid.nextTodo?.id).toBe("now-execution-panel");
  });

  it("handles last-step and plan-complete edges for the stepper", () => {
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
    };
    const lastStepPlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 2,
        pending: 0,
        inProgress: 1,
        items: [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" },
          { id: "narrow-plugin-shell", content: "Done", status: "completed" },
          { id: "now-execution-panel", content: "Now panel", status: "in_progress" },
        ],
      },
    };
    const last = buildCurrentExecution([lastStepPlan], handoff);
    expect(last.previousTodo?.id).toBe("narrow-plugin-shell");
    expect(last.currentTodo?.id).toBe("now-execution-panel");
    expect(last.nextTodo).toBeNull();

    const donePlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 3,
        pending: 0,
        inProgress: 0,
        items: [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" },
          { id: "narrow-plugin-shell", content: "Done", status: "completed" },
          { id: "now-execution-panel", content: "Done", status: "completed" },
        ],
      },
    };
    const done = buildCurrentExecution([donePlan], { ...handoff, mode: "manual" });
    expect(done.progress).toEqual({ completed: 3, total: 3 });
    expect(done.currentTodo).toBeNull();
    expect(done.nextTodo).toBeNull();
    expect(done.previousTodo?.id).toBe("now-execution-panel");
    expect(done.status).toBe("completed");
  });

  it("yields completed (not idle) for exhausted+terminal HANDOFF even when mode mentions orchestrated", () => {
    const donePlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 3,
        pending: 0,
        inProgress: 0,
        items: [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" },
          { id: "narrow-plugin-shell", content: "Done", status: "completed" },
          { id: "now-execution-panel", content: "Done", status: "completed" },
        ],
      },
    };
    const now = buildCurrentExecution([donePlan], {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "STOPPED (run-plan orchestrated; plan exhausted)",
      parkedPlans: [],
    });
    expect(now.status).toBe("completed");
    expect(now.status).not.toBe("idle");
    expect(now.status).not.toBe("executing");
    expect(now.lifecycle).toBe("completed");
    expect(now.planFile).toBe("mission-control-plugin-ux.plan.md");
    expect(now.progress).toEqual({ completed: 3, total: 3 });
  });

  it("keeps executing for active orchestrated run with open todos", () => {
    const now = buildCurrentExecution(samplePlans, {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
      nextTodos: "`semantic-snapshot-model`",
    });
    expect(now.status).toBe("executing");
    expect(now.currentTodo?.id).toBe("semantic-snapshot-model");
  });

  /**
   * Final-tick hold (Phase 3): HANDOFF Mode and plan to-do status can disagree
   * briefly. Open work must not collapse to completed/idle; terminal work must
   * stay completed once every to-do is terminal.
   */
  describe("HANDOFF transition lifecycle hold", () => {
    const exhaustedMode = "STOPPED (run-plan orchestrated; plan exhausted)";
    const liveMode = "run-plan (orchestrated)";

    const withItems = (
      items: { id: string; content: string; status: string }[],
      summary?: Partial<{ completed: number; pending: number; inProgress: number; total: number }>,
    ) => ({
      ...samplePlans[0],
      todos: {
        total: summary?.total ?? items.length,
        completed: summary?.completed ?? items.filter((t) => t.status === "completed").length,
        pending: summary?.pending ?? items.filter((t) => t.status === "pending").length,
        inProgress: summary?.inProgress ?? items.filter((t) => t.status === "in_progress").length,
        items,
      },
    });

    it("does not render completed or idle when exhausted HANDOFF still has in_progress work", () => {
      const plan = withItems([
        { id: "semantic-snapshot-model", content: "Done", status: "completed" },
        { id: "narrow-plugin-shell", content: "Shell", status: "in_progress" },
        { id: "now-execution-panel", content: "Now panel", status: "pending" },
      ]);
      const now = buildCurrentExecution([plan], {
        plan: "mission-control-plugin-ux.plan.md",
        mode: exhaustedMode,
        parkedPlans: [],
        nextTodos: "`narrow-plugin-shell`",
      });
      expect(now.status).not.toBe("completed");
      expect(now.status).not.toBe("idle");
      expect(now.status).toBe("executing");
      expect(now.lifecycle).toBe("executing");
      expect(now.currentTodo?.id).toBe("narrow-plugin-shell");
      expect(now.planFile).toBe("mission-control-plugin-ux.plan.md");
    });

    it("does not render completed or idle when exhausted HANDOFF still has pending work", () => {
      const plan = withItems([
        { id: "semantic-snapshot-model", content: "Done", status: "completed" },
        { id: "narrow-plugin-shell", content: "Shell", status: "pending" },
        { id: "now-execution-panel", content: "Now panel", status: "pending" },
      ]);
      const now = buildCurrentExecution([plan], {
        plan: "mission-control-plugin-ux.plan.md",
        mode: exhaustedMode,
        parkedPlans: [],
        nextTodos: "`narrow-plugin-shell`",
      });
      expect(now.status).not.toBe("completed");
      expect(now.status).not.toBe("idle");
      expect(now.status).toBe("awaiting_user");
      expect(now.lifecycle).toBe("awaiting_user");
      expect(now.currentTodo?.id).toBe("narrow-plugin-shell");
    });

    it("keeps completed when to-dos are terminal before Final HANDOFF marks exhausted", () => {
      const plan = withItems([
        { id: "semantic-snapshot-model", content: "Done", status: "completed" },
        { id: "narrow-plugin-shell", content: "Done", status: "completed" },
        { id: "now-execution-panel", content: "Done", status: "completed" },
      ]);
      const now = buildCurrentExecution([plan], {
        plan: "mission-control-plugin-ux.plan.md",
        mode: liveMode,
        parkedPlans: [],
        nextTodos: "`now-execution-panel`",
      });
      expect(now.status).toBe("completed");
      expect(now.status).not.toBe("idle");
      expect(now.status).not.toBe("executing");
      expect(now.progress).toEqual({ completed: 3, total: 3 });
      expect(now.previousTodo?.id).toBe("now-execution-panel");
      expect(now.currentTodo).toBeNull();
    });

    it("trusts item statuses over a stale all-done summary during transitions", () => {
      const plan = withItems(
        [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" },
          { id: "narrow-plugin-shell", content: "Shell", status: "in_progress" },
          { id: "now-execution-panel", content: "Now panel", status: "pending" },
        ],
        { total: 3, completed: 3, pending: 0, inProgress: 0 },
      );
      expect(
        classifyPlan(plan, {
          plan: "mission-control-plugin-ux.plan.md",
          mode: exhaustedMode,
          parkedPlans: [],
        }),
      ).toBe("executing");
      const now = buildCurrentExecution([plan], {
        plan: "mission-control-plugin-ux.plan.md",
        mode: exhaustedMode,
        parkedPlans: [],
      });
      expect(now.status).toBe("executing");
      expect(now.status).not.toBe("completed");
      expect(now.status).not.toBe("idle");
    });
  });
});

describe("formatGitActivity", () => {
  it("formats merge and commit lines without inventing timestamps", () => {
    const events = formatGitActivity([
      "34d3880 Merge pull request #200 from agent-kit-startup/docs/mission-control-security-adr",
      "abc1234 feat: mission control copy pid",
      "def4567 chore: git staging after tick",
    ]);

    expect(events[0]).toMatchObject({
      kind: "merge",
      label: "Merged PR #200 → 34d3880.",
      refs: { pr: 200, sha: "34d3880" },
      at: null,
    });
    expect(events[1].kind).toBe("commit");
    expect(events[1].label).toContain("Commit abc1234:");
    expect(events[2].kind).toBe("staging");
  });
});

describe("resolveDeliveryAttribution", () => {
  it("maps feat/branch to plan basename after prefix strip", () => {
    expect(
      resolveDeliveryAttribution("feat/monitor-agent-activity-focus", [
        { file: "monitor-agent-activity-focus.plan.md", agent: "docs-repo" },
        { file: "other.plan.md" },
      ]),
    ).toEqual({ plan: "monitor-agent-activity-focus.plan.md", agent: "docs-repo" });
  });

  it("returns nulls when no basename matches", () => {
    expect(
      resolveDeliveryAttribution("feat/unrelated-branch", [
        { file: "monitor-agent-activity-focus.plan.md" },
      ]),
    ).toEqual({ plan: null, agent: null });
  });

  it("returns nulls on ambiguous candidate hits", () => {
    expect(
      resolveDeliveryAttribution("feat/foo", [
        { file: "foo.plan.md" },
        { file: "feat-foo.plan.md" },
      ]),
    ).toEqual({ plan: null, agent: null });
  });
});

describe("formatDeliveryActivity", () => {
  it("maps conventional subjects and PR-only briefs to commitType subtypes", () => {
    expect(parseDeliveryCommitType("feat(x): ship it")).toBe("feat");
    expect(parseDeliveryCommitType("fix: broken chip")).toBe("fix");
    expect(parseDeliveryCommitType("docs: note")).toBe("docs");
    expect(parseDeliveryCommitType("chore: bump")).toBe("chore");
    expect(parseDeliveryCommitType("refactor(dashboard): tidy")).toBe("chore");
    expect(parseDeliveryCommitType(null, { hasPr: true })).toBe("pr");
    expect(parseDeliveryCommitType("Weird Subject", { hasPr: true })).toBe("pr");
    expect(parseDeliveryCommitType("Weird Subject")).toBe("ship");
  });

  it("anchors on the merge and absorbs the feature commits beneath it", () => {
    const events = formatDeliveryActivity(
      [
        "bbb2222 Merge pull request #42 from agent-kit-startup/feat/x",
        "aaa1111 feat(x): implement the thing",
        "ccc3333 test(x): cover the thing",
      ],
      { plans: [{ file: "x.plan.md", agent: "docs-repo" }] },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "delivery",
      agent: "docs-repo",
      refs: {
        sha: "bbb2222",
        commits: ["bbb2222", "aaa1111", "ccc3333"],
        pr: 42,
        plan: "x.plan.md",
        commitType: "feat",
      },
    });
    expect(events[0].label).toContain("docs-repo · shipped ·");
    expect(events[0].label).toContain("feat(x): implement the thing");
    expect(events[0].label).toContain("PR #42");
    expect(events[0].label).toContain("bbb2222");
    expect(events[0].label).not.toContain("Shipped:");
    expect(events[0].label).not.toContain("→");
    expect(events[0].id).toContain("delivery:");
  });

  it("handles a standalone merge with no commits beneath it", () => {
    const events = formatDeliveryActivity(
      ["abc1234 Merge pull request #10 from agent-kit-startup/feat/y"],
      { plans: [{ file: "y.plan.md" }] },
    );

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("delivery");
    expect(events[0].refs.pr).toBe(10);
    expect(events[0].refs.sha).toBe("abc1234");
    expect(events[0].refs.commits).toHaveLength(1);
    expect(events[0].refs.plan).toBe("y.plan.md");
    expect(events[0].refs.commitType).toBe("pr");
    expect(events[0].label).toMatch(/shipped · PR #10 · abc1234/);
    expect(events[0].label).not.toContain("Merged PR");
    expect(events[0].label).not.toContain("→");
  });

  it("returns empty array for empty input", () => {
    expect(formatDeliveryActivity([])).toEqual([]);
    expect(formatDeliveryActivity(["", "   "])).toEqual([]);
  });

  it("does not absorb unmerged commits above the newest merge", () => {
    const events = formatDeliveryActivity([
      "ddd4444 feat: local work in flight",
      "c6f63ed Merge pull request #326 from agent-kit-startup/fix/monitor-delivery-attribution",
      "c1379b2 fix(dashboard): attribute delivery events per merge branch",
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].refs.sha).toBe("c6f63ed");
    expect(events[0].refs.commits).toEqual(["c6f63ed", "c1379b2"]);
    expect(events[0].refs.pr).toBe(326);
    expect(events[0].refs.commitType).toBe("fix");
  });

  it("treats squash-merged commits as their own single-commit deliveries", () => {
    const events = formatDeliveryActivity(
      [
        "528901c Merge pull request #321 from agent-kit-startup/feat/monitor-agent-activity-focus",
        "6051036 feat(dashboard): refocus Monitor hero on agent activity",
        "74954c7 docs: update plan-review-triage for multi-path walk (#320)",
        "7a13573 feat: add header bulk CTAs for Field Report triage-all (#319)",
      ],
      { plans: [{ file: "monitor-agent-activity-focus.plan.md", agent: "docs-repo" }] },
    );

    expect(events).toHaveLength(3);
    expect(events[0].refs).toMatchObject({
      sha: "528901c",
      commits: ["528901c", "6051036"],
      pr: 321,
      plan: "monitor-agent-activity-focus.plan.md",
      commitType: "feat",
    });
    expect(events[0].label).toContain("docs-repo · shipped ·");
    expect(events[0].label).toContain("feat(dashboard): refocus Monitor hero on agent activity");
    expect(events[0].label).toContain("PR #321 · 528901c");
    expect(events[1].refs).toMatchObject({
      sha: "74954c7",
      commits: ["74954c7"],
      pr: 320,
      plan: null,
      commitType: "docs",
    });
    expect(events[1].label).toContain("Engineering Manager · shipped ·");
    expect(events[1].label).toContain("docs: update plan-review-triage for multi-path walk");
    expect(events[1].label).toContain("PR #320 · 74954c7");
    expect(events[1].label).not.toMatch(/\(#320\)/);
    expect(events[2].refs).toMatchObject({
      sha: "7a13573",
      commits: ["7a13573"],
      pr: 319,
      plan: null,
      commitType: "feat",
    });
    expect(events[2].label).toContain("feat: add header bulk CTAs for Field Report triage-all");
    expect(events[2].label).toContain("PR #319");
  });

  it("emits plan null when the merge branch maps to nothing", () => {
    const events = formatDeliveryActivity(
      ["bbb2222 Merge pull request #1 from agent-kit-startup/feat/z", "aaa1111 feat(z): something"],
      { plans: [{ file: "other.plan.md", agent: "my-agent" }] },
    );

    expect(events).toHaveLength(1);
    expect(events[0].agent).toBeNull();
    expect(events[0].refs.plan).toBeNull();
    expect(events[0].refs.sha).toBe("bbb2222");
    expect(events[0].refs.commits).toEqual(["bbb2222", "aaa1111"]);
  });

  it("attributes each merge-PR delivery from its own branch, not the active plan", () => {
    expect(extractMergeBranch(" from agent-kit-startup/feat/monitor-agent-activity-focus")).toBe(
      "feat/monitor-agent-activity-focus",
    );
    const events = formatDeliveryActivity(
      [
        "e1182a1 Merge pull request #325 from agent-kit-startup/docs/index-one-fold-monitors",
        "cbc68ca docs(memory): index desktop one-fold and field-report monitors",
        "528901c Merge pull request #321 from agent-kit-startup/feat/monitor-agent-activity-focus",
        "6051036 feat(dashboard): refocus Monitor hero on agent activity",
        "fbde80a Merge pull request #317 from agent-kit-startup/update/field-report-flat-list",
      ],
      {
        plans: [
          {
            file: "monitor-agent-activity-focus.plan.md",
            agent: "monitor-agent-activity-focus",
          },
          { file: "field-report-owed-external-review.plan.md", agent: "should-not-stamp" },
        ],
      },
    );

    expect(events).toHaveLength(3);
    expect(events.map((e) => ({ pr: e.refs.pr, plan: e.refs.plan, agent: e.agent }))).toEqual([
      { pr: 325, plan: null, agent: null },
      {
        pr: 321,
        plan: "monitor-agent-activity-focus.plan.md",
        // Plan-slug agent values are not kit agent ids → null.
        agent: null,
      },
      { pr: 317, plan: null, agent: null },
    ]);
    expect(events[1].refs.commits).toEqual(["528901c", "6051036"]);
    expect(events[0].label).not.toContain("field-report-owed-external-review");
    // Plan attribution stays on refs; label actor is Engineering Manager when agent is not a kit id.
    expect(events[1].refs.plan).toBe("monitor-agent-activity-focus.plan.md");
    expect(events[1].label).toContain("Engineering Manager · shipped ·");
  });

  it("honors a limit option like other activity producers", () => {
    const lines = [
      "aaa1111 Merge pull request #3 from agent-kit-startup/feat/a",
      "bbb2222 Merge pull request #2 from agent-kit-startup/feat/b",
      "ccc3333 Merge pull request #1 from agent-kit-startup/feat/c",
    ];
    expect(formatDeliveryActivity(lines, { limit: 2 })).toHaveLength(2);
    expect(formatDeliveryActivity(lines, { limit: 1 })[0].refs.pr).toBe(3);
  });
});

describe("formatPlanHandoffActivity + mergeActivity", () => {
  it("prefers run-plan tick sentences and bounds output", () => {
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "Night shift: /run-plan orchestrated",
      parkedPlans: [],
    };
    const now = buildCurrentExecution(samplePlans, handoff);
    const planEvents = formatPlanHandoffActivity({
      now,
      handoff,
      plans: samplePlans,
    });
    expect(planEvents[0].kind).toBe("run_plan");
    expect(planEvents[0].label).toMatch(/· running ·/);
    expect(planEvents[0].label).toContain("semantic-snapshot-model");
    expect(planEvents[0].label).toContain("mission-control-plugin-ux.plan.md");
    // Meaningful info first: todo id lands before the plan filename.
    expect(planEvents[0].label.indexOf("semantic-snapshot-model")).toBeLessThan(
      planEvents[0].label.indexOf("mission-control-plugin-ux.plan.md"),
    );

    const merged = mergeActivity([
      planEvents,
      formatGitActivity(Array.from({ length: 30 }, (_, i) => `aaaaaa${i} commit ${i}`)),
    ]);
    expect(merged.length).toBeLessThanOrEqual(MAX_ACTIVITY);
    expect(new Set(merged.map((e) => e.id)).size).toBe(merged.length);
  });

  it("carries agent attribution from plan records on run_plan events", () => {
    const planWithAgent = {
      ...samplePlans[0],
      agent: "docs-repo",
    };
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
    };
    const now = buildCurrentExecution([planWithAgent], handoff);
    const planEvents = formatPlanHandoffActivity({
      now,
      handoff,
      plans: [planWithAgent],
    });
    expect(planEvents[0].agent).toBe("docs-repo");
    expect(planEvents[0].kind).toBe("run_plan");
    expect(planEvents[0].label).toMatch(/^docs-repo · running ·/);
  });

  it("emits denser agent_step rows for active-plan completed/running todos", () => {
    const planWithSteps = {
      ...samplePlans[0],
      agent: "generalPurpose",
      todos: {
        total: 4,
        completed: 2,
        pending: 1,
        inProgress: 1,
        items: [
          { id: "step-a", content: "A", status: "completed" },
          { id: "step-b", content: "B", status: "completed" },
          { id: "step-c", content: "C", status: "in_progress" },
          { id: "step-d", content: "D", status: "pending" },
        ],
      },
    };
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
    };
    const now = buildCurrentExecution([planWithSteps], handoff);
    const planEvents = formatPlanHandoffActivity({
      now,
      handoff,
      plans: [planWithSteps],
    });
    const steps = planEvents.filter((e) => e.kind === "agent_step");
    expect(steps.length).toBe(3);
    expect(steps.map((e) => e.refs?.todo)).toEqual(["step-a", "step-b", "step-c"]);
    expect(steps.map((e) => e.refs?.phase)).toEqual(["done", "done", "running"]);
    // Natural voice: phase word first, then the todo id; no robotic "step" separator.
    // "generalPurpose" is not a kit agent id, so the actor falls back to Squad.
    expect(steps[0].label).toMatch(/^Squad · done · step-a/);
    expect(steps[2].label).toMatch(/^Squad · running · step-c/);
    expect(steps.every((e) => MONITOR_ACTIVITY_KINDS.includes(e.kind))).toBe(true);
    expect(planEvents.some((e) => e.kind === "run_plan")).toBe(true);
  });

  it("labels handoff rows as awaiting with the gate first", () => {
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "START-PROJECT Gate A complete, awaiting Gate B",
      parkedPlans: [],
      nextTodos: "`semantic-snapshot-model`",
    };
    const pendingPlan = {
      ...samplePlans[0],
      todos: {
        ...samplePlans[0].todos,
        inProgress: 0,
        items: samplePlans[0].todos.items.map((todo) => ({
          ...todo,
          status: "pending",
        })),
      },
    };
    const now = buildCurrentExecution([pendingPlan], handoff);
    expect(now.status).toBe("awaiting_user");
    const planEvents = formatPlanHandoffActivity({
      now,
      handoff,
      plans: samplePlans,
    });
    const gate = planEvents.find((e) => e.kind === "handoff");
    expect(gate.label).toMatch(/^Squad · awaiting · next \S+/);
    expect(gate.label).not.toContain("mission-control-plugin-ux.plan.md");
    expect(gate.labelFull).toContain("mission-control-plugin-ux.plan.md");
    expect(gate.labelFull.startsWith(gate.label)).toBe(true);
  });

  it("sets agent on plan_progress from plan.agent when it is a kit agent id", () => {
    const completedPlan = {
      ...samplePlans[1],
      agent: "tech-lead",
      todos: {
        total: 2,
        completed: 2,
        pending: 0,
        inProgress: 0,
        items: [
          { id: "a", content: "A", status: "completed" },
          { id: "b", content: "B", status: "completed" },
        ],
      },
    };
    const events = formatPlanHandoffActivity({
      now: null,
      handoff: { plan: null, parkedPlans: [] },
      plans: [completedPlan],
    });
    const progress = events.filter((e) => e.kind === "plan_progress");
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0].agent).toBe("tech-lead");
    expect(progress[0].label).toMatch(/^tech-lead · done ·/);
    expect(progress[0].label).toContain("2/2");
    // Monitor hero: live actions + denser agent_step; milestones stay on Activity
    expect(MONITOR_ACTIVITY_KINDS).toEqual(["run_plan", "handoff", "delivery", "agent_step"]);
    expect(MONITOR_ACTIVITY_KINDS).not.toContain("plan_progress");
    expect(MONITOR_FEED_CAP).toBe(20);
    expect(MONITOR_AGENT_STEP_EMIT_CAP).toBe(12);
    expect(buildMissionControlView({}).monitorFeedCap).toBe(MONITOR_FEED_CAP);
  });

  it("nulls plan_progress agent when the value is not a kit agent id", () => {
    const completedPlan = {
      ...samplePlans[1],
      agent: "not-a-kit-agent",
      todos: {
        total: 1,
        completed: 1,
        pending: 0,
        inProgress: 0,
        items: [{ id: "a", content: "A", status: "completed" }],
      },
    };
    const events = formatPlanHandoffActivity({
      now: null,
      handoff: { plan: null, parkedPlans: [] },
      plans: [completedPlan],
    });
    expect(events.find((e) => e.kind === "plan_progress")?.agent).toBeNull();
  });
});

describe("briefActivityActor", () => {
  it("prefers kit agent, then delivery Engineering Manager, then Squad, then Platform Engineer", () => {
    expect(briefActivityActor("docs-repo", { kind: "run_plan" })).toBe("docs-repo");
    expect(briefActivityActor(null, { kind: "delivery", plan: "x.plan.md" })).toBe(
      "Engineering Manager",
    );
    // Lexicon fallback: never the full plan filename in the actor slot.
    expect(briefActivityActor(null, { kind: "run_plan", plan: "x.plan.md" })).toBe("Squad");
    expect(briefActivityActor(null, { kind: "agent_step", plan: "x.plan.md" })).toBe("Squad");
    expect(briefActivityActor(null, { kind: "handoff", plan: "x.plan.md" })).toBe("Squad");
    expect(briefActivityActor(null, { kind: "plan_progress", plan: "x.plan.md" })).toBe("Squad");
    expect(briefActivityActor(null, { kind: "handoff" })).toBe("Platform Engineer");
  });
});

describe("deriveBusyOutsidePlan", () => {
  const nowMs = Date.parse("2026-07-31T20:00:00.000Z");
  const freshAt = new Date(nowMs - 60_000).toISOString();
  const staleAt = new Date(nowMs - BUSY_OUTSIDE_PLAN_FRESH_MS - 60_000).toISOString();
  const runEvidenceTerminal = {
    id: "7.txt",
    updatedAt: freshAt,
    lastOutput: "LOOP_TICK_RESULT tick ok",
  };

  it("is inactive without a now slice or without terminals", () => {
    expect(deriveBusyOutsidePlan({ terminals: [runEvidenceTerminal], nowMs })).toEqual({
      active: false,
      evidence: [],
    });
    expect(deriveBusyOutsidePlan({ now: { status: "idle" }, nowMs })).toEqual({
      active: false,
      evidence: [],
    });
  });

  it("activates on fresh run-loop terminal evidence while the mission is idle", () => {
    const result = deriveBusyOutsidePlan({
      now: { status: "idle" },
      terminals: [runEvidenceTerminal],
      nowMs,
    });
    expect(result.active).toBe(true);
    expect(result.evidence).toEqual([{ terminal: "7.txt", at: freshAt }]);
  });

  it("activates while awaiting_user or completed, not only idle", () => {
    for (const status of ["awaiting_user", "completed"]) {
      const result = deriveBusyOutsidePlan({
        now: { status },
        terminals: [runEvidenceTerminal],
        nowMs,
      });
      expect(result.active).toBe(true);
    }
  });

  it("stays inactive while the mission is executing (in-plan chrome owns the state)", () => {
    const result = deriveBusyOutsidePlan({
      now: { status: "executing" },
      terminals: [runEvidenceTerminal],
      nowMs,
    });
    expect(result.active).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  it("ignores stale evidence outside the freshness window", () => {
    const stale = { ...runEvidenceTerminal, updatedAt: staleAt };
    expect(
      deriveBusyOutsidePlan({ now: { status: "idle" }, terminals: [stale], nowMs }).active,
    ).toBe(false);
  });

  it("ignores terminals without run-loop evidence or without a parseable mtime", () => {
    const noEvidence = { id: "8.txt", updatedAt: freshAt, lastOutput: "npm test passed" };
    const noMtime = { id: "9.txt", lastOutput: "LOOP_TICK_RESULT tick ok" };
    const badMtime = { ...runEvidenceTerminal, id: "10.txt", updatedAt: "not-a-date" };
    const result = deriveBusyOutsidePlan({
      now: { status: "idle" },
      terminals: [noEvidence, noMtime, badMtime],
      nowMs,
    });
    expect(result.active).toBe(false);
  });

  it("buildMissionControlView attaches busyOutsidePlan to the now slice", () => {
    const idleView = buildMissionControlView({ terminals: [runEvidenceTerminal], nowMs });
    expect(idleView.now.status).toBe("idle");
    expect(idleView.now.busyOutsidePlan?.active).toBe(true);

    const executingView = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "run-plan (in-session loop)",
        parkedPlans: [],
      },
      terminals: [runEvidenceTerminal],
      nowMs,
    });
    expect(executingView.now.status).toBe("executing");
    expect(executingView.now.busyOutsidePlan?.active).toBe(false);
  });
});

describe("normalizeKitAgentId + deliverySupersededShas", () => {
  it("accepts kit agent ids and rejects plan slugs", () => {
    expect(normalizeKitAgentId("docs-repo")).toBe("docs-repo");
    expect(normalizeKitAgentId("monitor-agent-activity-focus")).toBeNull();
    expect(normalizeKitAgentId(null)).toBeNull();
  });

  it("collects merge and absorbed commit SHAs from delivery refs", () => {
    expect(
      [
        ...deliverySupersededShas([{ refs: { sha: "aaa1111", commits: ["aaa1111", "bbb2222"] } }]),
      ].sort(),
    ).toEqual(["aaa1111", "bbb2222"]);
  });
});

const awaitingHandoff = {
  plan: "mission-control-plugin-ux.plan.md",
  mode: "awaiting Gate B",
  parkedPlans: ["mission-control-hardening.plan.md", "parked-open-work.plan.md"],
  nextTodos: "`semantic-snapshot-model`",
};

const awaitingPlan = {
  ...samplePlans[0],
  todos: {
    ...samplePlans[0].todos,
    inProgress: 0,
    pending: 3,
    items: samplePlans[0].todos.items.map((t) => ({
      ...t,
      status: "pending",
    })),
  },
};

const awaitingPlans = [awaitingPlan, samplePlans[1], samplePlans[2], parkedOpenPlan];

const readinessAdvisory = [
  {
    id: "confirm-provider",
    status: "needs_choice",
    essential: false,
    title: "Confirm collaboration provider",
  },
];

function expectHonestActions(items: { action?: { type: string; label: string } }[]) {
  for (const item of items) {
    expect(item).toMatchObject({
      kind: expect.any(String),
      severity: expect.any(String),
      label: expect.any(String),
      sourcePath: expect.any(String),
      action: expect.objectContaining({
        type: expect.stringMatching(/^(path|copy)$/),
        target: expect.any(String),
        label: expect.any(String),
      }),
    });
  }
  // The panel cannot open anything: path CTAs copy at the data layer too.
  for (const item of items.filter((i) => i.action?.type === "path")) {
    expect(item.action?.label).toBe("Copy path");
    expect(item.action?.label).not.toMatch(/^Open\b/i);
  }
}

const untriagedReport = parseExternalReport({
  file: "plan-monitor-widget-rollout.md",
  content: "# Monitor log - widget-rollout\n\nNo triage outcome recorded yet.\n",
  modifiedAt: "2026-07-24T08:30:00.000Z",
});

describe("buildAttentionItems", () => {
  it("carries untriaged external reviews", () => {
    const items = buildAttentionItems({
      plans: [],
      handoff: null,
      externalReports: [untriagedReport],
    });

    expect(items.map((i) => i.id)).toEqual(["attention:report:widget-rollout"]);
    expectHonestActions(items);
  });

  it("carries readiness and prompts alongside external reviews, not plan-state", () => {
    const items = buildAttentionItems({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      agentPrompts: [{ chatId: "chat-await", label: "Pick a Gate A option" }],
      externalReports: [untriagedReport],
      readinessPending: readinessAdvisory,
    });

    expect(items.some((i) => i.id === "attention:handoff-awaiting")).toBe(false);
    expect(items.some((i) => i.kind === "prompt")).toBe(true);
    expect(items.some((i) => i.kind === "report")).toBe(true);
    expect(
      items.some((i) => i.kind === "incomplete" || i.kind === "parked" || i.kind === "backlog"),
    ).toBe(false);
    expect(items.some((i) => i.kind === "readiness")).toBe(true);

    // Even while the current execution awaits a user decision, no HANDOFF gate row lands here.
    const view = buildMissionControlView({ plans: awaitingPlans, handoff: awaitingHandoff });
    expect(view.now.status).toBe("awaiting_user");
    expect(view.attention.every((i) => i.kind !== "handoff")).toBe(true);
  });

  it("attaches a copy-only resolve command and honors dismissed report ids", () => {
    const item = buildAttentionItems({
      plans: [],
      handoff: null,
      externalReports: [untriagedReport],
    }).find((i) => i.kind === "report");
    expect(item?.resolveAction).toMatchObject({
      type: "copy",
      target: "/field-report-resolve attention:report:widget-rollout",
      pasteDestination: "chatInput",
    });

    const filtered = buildAttentionItems({
      plans: [],
      handoff: null,
      externalReports: [untriagedReport],
      dismissedIds: ["attention:report:widget-rollout"],
    });
    expect(filtered).toEqual([]);
  });
});

describe("buildChecklistNotes", () => {
  it("emits advisory readiness only (no plan-state NOTE kinds)", () => {
    const notes = buildChecklistNotes({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      readinessPending: readinessAdvisory,
    });

    expect(notes.every((i) => i.kind === "readiness")).toBe(true);
    expect(notes.some((i) => i.id.includes("confirm-provider"))).toBe(true);
    expect(
      notes.some((i) => i.kind === "parked" || i.kind === "incomplete" || i.kind === "backlog"),
    ).toBe(false);
    expectHonestActions(notes);
  });

  it("does not emit plan-state notes for parked or incomplete plans", () => {
    const notes = buildChecklistNotes({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      readinessPending: readinessAdvisory,
    });

    expect(notes.filter((i) => i.kind === "parked" || i.kind === "incomplete")).toEqual([]);
    expect(new Set(notes.map((i) => i.id)).size).toBe(notes.length);
    expect(notes.some((i) => i.kind === "readiness" && i.planFile)).toBe(false);
  });

  it("skips plan-state notes when parked plan has zero open todos", () => {
    const notes = buildChecklistNotes({
      plans: [samplePlans[1]],
      handoff: {
        plan: "other.plan.md",
        parkedPlans: ["mission-control-hardening.plan.md"],
      },
    });
    expect(notes.some((i) => i.kind === "parked")).toBe(false);
  });

  it("does not emit backlog or Incomplete NOTE kinds for queued backlog plans", () => {
    const notes = buildChecklistNotes({
      plans: [backlogOpenPlan, backlogDonePlan],
      handoff: {
        plan: "other.plan.md",
        parkedPlans: [],
        backlogPlans: ["refresh-icon-button.plan.md", "backlog-done.plan.md"],
      },
    });
    expect(notes.some((i) => i.kind === "backlog")).toBe(false);
    expect(notes.some((i) => i.kind === "incomplete")).toBe(false);
    expect(notes.some((i) => i.planFile === "backlog-done.plan.md")).toBe(false);
  });

  it("skips the active plan and essential or ready readiness checks", () => {
    const notes = buildChecklistNotes({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      readinessPending: [
        { id: "git-init", status: "missing", essential: true },
        { id: "hooks", status: "ready", essential: false },
      ],
    });

    expect(notes.some((i) => i.planFile === "mission-control-plugin-ux.plan.md")).toBe(false);
    expect(notes.some((i) => i.kind === "readiness")).toBe(false);
  });

  it("keeps needs_choice readiness and does not false-clear on empty deferredItems", () => {
    const notes = buildChecklistNotes({
      plans: [],
      handoff: null,
      readinessPending: readinessAdvisory,
      deferredCheckIds: [],
    });
    const readiness = notes.find((i) => i.id.includes("confirm-provider"));
    expect(readiness).toBeTruthy();
    expect(readiness?.action).toMatchObject({
      type: "copy",
      target: "/agent-kit-onboard",
      label: "Copy /agent-kit-onboard (non-essential)",
    });
  });

  it("suppresses readiness when deferredItems.checkId matches pillar check or action id", () => {
    const pending = [
      {
        id: "confirm-provider",
        checkId: "collaboration.provider",
        status: "needs_choice",
        essential: false,
        title: "Confirm collaboration provider",
      },
    ];
    const byCheck = buildChecklistNotes({
      plans: [],
      handoff: null,
      readinessPending: pending,
      deferredCheckIds: ["collaboration.provider"],
    });
    expect(byCheck.some((i) => i.kind === "readiness")).toBe(false);

    const byAction = buildChecklistNotes({
      plans: [],
      handoff: null,
      readinessPending: pending,
      deferredCheckIds: ["confirm-provider"],
    });
    expect(byAction.some((i) => i.kind === "readiness")).toBe(false);
  });
});

describe("collectReadinessPendingFromReport + collectDeferredCheckIds", () => {
  it("enriches pending actions with checkId and essential from pillars", () => {
    const pending = collectReadinessPendingFromReport({
      pillars: [
        {
          pillar: "collaboration",
          checks: [
            {
              id: "collaboration.provider",
              title: "Repository provider",
              status: "needs_choice",
              essential: false,
              actions: [{ id: "confirm-provider", status: "needs_choice" }],
            },
            {
              id: "git.repository",
              title: "Git",
              status: "missing",
              essential: true,
              actions: [{ id: "git-init", status: "missing" }],
            },
          ],
        },
      ],
      pendingActions: [{ id: "confirm-provider", status: "needs_choice" }],
    });
    expect(pending).toEqual([
      {
        id: "confirm-provider",
        checkId: "collaboration.provider",
        status: "needs_choice",
        essential: false,
        title: "Repository provider",
      },
      {
        id: "git-init",
        checkId: "git.repository",
        status: "missing",
        essential: true,
        title: "Git",
      },
    ]);
  });

  it("reads deferred checkIds only when reason is non-empty", () => {
    expect(
      collectDeferredCheckIds({
        onboarding: {
          deferredItems: [
            {
              checkId: "collaboration.provider",
              reason: "Local-only for now",
              recoveryCommand: "/agent-kit-onboard",
            },
            { checkId: "quality.validation", reason: "   " },
            { checkId: "", reason: "noop" },
          ],
        },
      }),
    ).toEqual(["collaboration.provider"]);
    expect(collectDeferredCheckIds({ onboarding: { deferredItems: [] } })).toEqual([]);
  });
});

describe("allowlistReadinessPending", () => {
  it("keeps only safe fields", () => {
    const out = allowlistReadinessPending([
      {
        id: "confirm-provider",
        checkId: "collaboration.provider",
        status: "needs_choice",
        essential: false,
        title: "Confirm",
        secretDump: { remote: "should-not-leak" },
      },
    ]);
    expect(out[0]).toEqual({
      id: "confirm-provider",
      checkId: "collaboration.provider",
      status: "needs_choice",
      essential: false,
      title: "Confirm",
    });
    expect(out[0]).not.toHaveProperty("secretDump");
  });
});

describe("buildMissionControlView", () => {
  it("assembles now, activity, checklist notes, and classified plans", () => {
    const handoff = parseHandoffMarkdown(`# Handoff
- **Plan:** \`mission-control-plugin-ux.plan.md\`
- **Mode:** run-plan (orchestrated)
- **Next to-dos:** \`semantic-snapshot-model\`
- **Backlog plans:**
  - \`refresh-icon-button.plan.md\`
- **Parked plans:** \`mission-control-hardening.plan.md\`
`);
    const view = buildMissionControlView({
      plans: [...samplePlans, backlogOpenPlan],
      handoff,
      gitLogLines: ["34d3880 Merge pull request #200 from agent-kit-startup/docs/x"],
      readinessPending: [{ id: "confirm-provider", status: "needs_choice", essential: false }],
    });

    expect(view.schemaVersion).toBe("1.0.0");
    expect(view.now.status).toBe("executing");
    expect(view.now.currentTodo?.id).toBe("semantic-snapshot-model");
    // Delivery supersedes the raw merge row for the same SHA.
    expect(view.activity.some((e) => e.kind === "delivery")).toBe(true);
    expect(view.activity.some((e) => e.kind === "merge")).toBe(false);
    // Contract change: parked + all-completed → completed; parked flag preserved.
    const hardening = view.plans.find((p) => p.file.includes("hardening"));
    expect(hardening?.lifecycle).toBe("completed");
    expect(hardening?.parked).toBe(true);
    const backlog = view.plans.find((p) => p.file === "refresh-icon-button.plan.md");
    expect(backlog?.lifecycle).toBe("backlog");
    expect(backlog?.backlog).toBe(true);
    expect(backlog?.parked).toBe(false);
    // Field Report heads-up: readiness only from this fixture (no agentPrompts /
    // reports). Plan-state NOTE kinds stay off the stack; Checklist owns cards.
    expect(view.attention.map((i) => i.kind)).not.toContain("parked");
    expect(view.attention.map((i) => i.kind)).not.toContain("backlog");
    expect(view.attention.map((i) => i.kind)).not.toContain("incomplete");
    expect(view.attention.map((i) => i.kind)).toContain("readiness");
    expect(view.checklistNotes).toEqual([]);
  });

  it("keeps activity ids and ordering stable across snapshots (SSE dedupe key)", () => {
    const handoff = parseHandoffMarkdown(`# Handoff
- **Plan:** \`mission-control-plugin-ux.plan.md\`
- **Mode:** run-plan (orchestrated)
- **Next to-dos:** \`semantic-snapshot-model\`
- **Parked plans:** \`mission-control-hardening.plan.md\`
`);
    const input = {
      plans: samplePlans,
      handoff,
      gitLogLines: [
        "34d3880 Merge pull request #200 from agent-kit-startup/docs/x",
        "abc1234 feat: mission control copy pid",
      ],
    };
    const first = buildMissionControlView(input);
    const second = buildMissionControlView(input);

    const firstIds = first.activity.map((e) => e.id);
    const secondIds = second.activity.map((e) => e.id);
    expect(secondIds).toEqual(firstIds);
    expect(new Set(firstIds).size).toBe(firstIds.length);
  });

  it("places delivery ahead of raw git and drops superseded merge/commit rows", () => {
    const handoff = {
      plan: "mission-control-plugin-ux.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
    };
    // Flood of plain commits would starve delivery if git ran first under MAX_ACTIVITY.
    const flood = Array.from({ length: 40 }, (_, i) => {
      const n = String(i).padStart(5, "0");
      return `ffff${n} chore: noise commit ${i}`;
    });
    const view = buildMissionControlView({
      plans: samplePlans,
      handoff,
      gitLogLines: [
        "34d3880 Merge pull request #200 from agent-kit-startup/docs/x",
        "abc1234 feat: absorbed under merge",
        ...flood,
      ],
    });

    expect(view.activity.some((e) => e.kind === "delivery")).toBe(true);
    expect(view.activity.some((e) => e.kind === "merge")).toBe(false);
    expect(view.activity.some((e) => e.refs?.sha === "abc1234")).toBe(false);
    const kinds = view.activity.map((e) => e.kind);
    const deliveryIdx = kinds.indexOf("delivery");
    const commitIdx = kinds.findIndex((k) => k === "commit");
    expect(deliveryIdx).toBeGreaterThanOrEqual(0);
    if (commitIdx >= 0) expect(deliveryIdx).toBeLessThan(commitIdx);
  });

  it("merges inventory deltas into activity without noise kinds or Monitor-only pollution of git/plan producers", () => {
    const previous = buildInventoryBaseline({
      agents: [{ id: "docs-repo", description: "Docs" }],
      skills: [{ id: "core/clean-code", title: "Clean", description: "A" }],
      commands: [{ id: "continue-plan" }],
      memory: {
        errorEntries: [{ id: "2026-07-01_old", modifiedAt: "2026-07-01T00:00:00.000Z" }],
        decisionEntries: [{ id: "2026-07-01_dec", modifiedAt: "2026-07-01T00:00:00.000Z" }],
      },
    });
    const view = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "run-plan (orchestrated)",
        parkedPlans: [],
      },
      gitLogLines: ["34d3880 Merge pull request #200 from agent-kit-startup/docs/x"],
      agents: [
        { id: "docs-repo", description: "Docs updated" },
        { id: "tech-lead", description: "Lead" },
      ],
      skills: [{ id: "core/clean-code", title: "Clean", description: "A" }],
      commands: [{ id: "continue-plan" }, { id: "run-plan" }],
      memory: {
        errorEntries: [],
        decisionEntries: [
          { id: "2026-07-01_dec", modifiedAt: "2026-07-01T00:00:00.000Z" },
          { id: "2026-07-26_new", modifiedAt: "2026-07-26T00:00:00.000Z" },
        ],
      },
      previousInventory: previous,
    });

    expect(view.activity.some((e) => e.kind === "run_plan")).toBe(true);
    expect(view.activity.some((e) => e.kind === "delivery")).toBe(true);
    expect(view.activity.some((e) => e.kind === "merge")).toBe(false);
    expect(view.activity.some((e) => e.kind === "agent" && e.refs?.action === "added")).toBe(true);
    expect(view.activity.some((e) => e.kind === "command" && e.refs?.action === "added")).toBe(
      true,
    );
    expect(view.activity.some((e) => e.kind === "memory" && e.refs?.action === "removed")).toBe(
      true,
    );
    expect(view.activity.every((e) => !["refresh", "heartbeat", "process"].includes(e.kind))).toBe(
      true,
    );
    // Inventory kinds are on the stream but outside the Monitor allowlist.
    expect(
      view.activity
        .filter((e) => ["agent", "skill", "command", "memory"].includes(e.kind))
        .every((e) => !MONITOR_ACTIVITY_KINDS.includes(e.kind)),
    ).toBe(true);
  });
});

describe("formatInventoryActivity", () => {
  const baseSnap = {
    agents: [
      { id: "docs-repo", description: "Docs agent" },
      { id: "tech-lead", description: "Lead" },
    ],
    skills: [
      { id: "core/clean-code", title: "Clean code", description: "Style" },
      { id: "community/sql-postgres", title: "SQL", description: "Postgres" },
    ],
    commands: [{ id: "continue-plan" }, { id: "git-staging" }],
    memory: {
      errorEntries: [{ id: "2026-07-01_old-error", modifiedAt: "2026-07-01T10:00:00.000Z" }],
      decisionEntries: [{ id: "2026-07-01_old-decision", modifiedAt: "2026-07-01T11:00:00.000Z" }],
    },
  };

  it("emits nothing on cold start (no previous baseline)", () => {
    expect(formatInventoryActivity(baseSnap, null)).toEqual([]);
    expect(formatInventoryActivity(baseSnap, undefined)).toEqual([]);
  });

  it("emits added/removed/changed with stable ids, source, and bounded labels", () => {
    const previous = buildInventoryBaseline(baseSnap);
    const current = {
      agents: [
        { id: "docs-repo", description: "Docs agent (edited)" },
        { id: "memory-extractor", description: "Memory" },
      ],
      skills: [
        { id: "core/clean-code", title: "Clean code", description: "Style" },
        { id: "core/docs-repo", title: "Docs", description: "New skill" },
      ],
      commands: [{ id: "continue-plan" }],
      memory: {
        errorEntries: [{ id: "2026-07-01_old-error", modifiedAt: "2026-07-02T10:00:00.000Z" }],
        decisionEntries: [
          { id: "2026-07-01_old-decision", modifiedAt: "2026-07-01T11:00:00.000Z" },
          { id: "2026-07-26_new-decision", modifiedAt: "2026-07-26T12:00:00.000Z" },
        ],
      },
    };

    const events = formatInventoryActivity(current, previous);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));

    expect(byId["agent:removed:tech-lead"]).toMatchObject({
      kind: "agent",
      source: "agents",
      label: "Agent removed: tech-lead",
      refs: { name: "tech-lead", action: "removed" },
    });
    expect(byId["agent:added:memory-extractor"]).toMatchObject({
      kind: "agent",
      source: "agents",
      refs: { action: "added" },
    });
    expect(byId["agent:changed:docs-repo"]).toMatchObject({
      kind: "agent",
      source: "agents",
      refs: { action: "changed" },
    });
    expect(byId["skill:added:core/docs-repo"]).toMatchObject({
      kind: "skill",
      source: "skills",
    });
    expect(byId["skill:removed:community/sql-postgres"]).toBeTruthy();
    expect(byId["command:removed:git-staging"]).toMatchObject({
      kind: "command",
      source: "commands",
    });
    expect(byId["memory:error:changed:2026-07-01_old-error"]).toMatchObject({
      kind: "memory",
      source: "memory",
      refs: { action: "changed" },
    });
    expect(byId["memory:decision:added:2026-07-26_new-decision"]).toMatchObject({
      kind: "memory",
      source: "memory",
      refs: { action: "added" },
    });

    for (const ev of events) {
      expect(ev.label.length).toBeLessThanOrEqual(200);
      expect(ev.id.length).toBeLessThanOrEqual(120);
    }
  });

  it("dedupes identical deltas across repeated diffs (stable ids)", () => {
    const previous = buildInventoryBaseline(baseSnap);
    const current = {
      ...baseSnap,
      agents: [...baseSnap.agents, { id: "new-agent", description: "N" }],
    };
    const first = formatInventoryActivity(current, previous);
    const second = formatInventoryActivity(current, previous);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    expect(first.filter((e) => e.id === "agent:added:new-agent")).toHaveLength(1);

    const merged = mergeActivity([first, second]);
    expect(merged.filter((e) => e.id === "agent:added:new-agent")).toHaveLength(1);
  });

  it("bounds inventory event count", () => {
    const previous = buildInventoryBaseline({ agents: [], skills: [], commands: [], memory: {} });
    const current = {
      agents: Array.from({ length: 40 }, (_, i) => ({
        id: `agent-${i}`,
        description: `A${i}`,
      })),
      skills: [],
      commands: [],
      memory: {},
    };
    const events = formatInventoryActivity(current, previous);
    expect(events.length).toBeLessThanOrEqual(MAX_INVENTORY_ACTIVITY);
  });

  it("emits no events when inventory is unchanged", () => {
    const previous = buildInventoryBaseline(baseSnap);
    expect(formatInventoryActivity(baseSnap, previous)).toEqual([]);
  });
});

describe("mission execution timing", () => {
  const t0 = Date.parse("2026-07-26T12:00:00.000Z");
  const handoff = {
    plan: "mission-control-plugin-ux.plan.md",
    mode: "run-plan (orchestrated)",
    parkedPlans: [],
  };

  it("omits timing when Current mission is idle", () => {
    const idle = buildCurrentExecution(samplePlans, null);
    const { timing } = observeMissionTiming(emptyMissionTimingLedger(), idle, { nowMs: t0 });
    expect(timing).toBeNull();
    const withNulls = withMissionTiming(idle, null);
    expect(withNulls.totalElapsedMs).toBeNull();
    expect(withNulls.stages).toBeNull();
  });

  it("starts total and current stage on first observation", () => {
    const now = buildCurrentExecution(samplePlans, handoff);
    const { timing, ledger } = observeMissionTiming(emptyMissionTimingLedger(), now, {
      nowMs: t0,
      todoItems: samplePlans[0].todos.items,
    });
    expect(timing?.totalElapsedMs).toBe(0);
    expect(timing?.currentStageId).toBe("semantic-snapshot-model");
    expect(timing?.currentStageElapsedMs).toBe(0);
    expect(now.planFile).toBe("mission-control-plugin-ux.plan.md");
    expect(ledger.missions["mission-control-plugin-ux.plan.md"]?.startedAt).toBe(
      "2026-07-26T12:00:00.000Z",
    );
  });

  it("grows elapsed while live and switches stages", () => {
    const now = buildCurrentExecution(samplePlans, handoff);
    const first = observeMissionTiming(emptyMissionTimingLedger(), now, {
      nowMs: t0,
      todoItems: samplePlans[0].todos.items,
    });
    const later = observeMissionTiming(first.ledger, now, {
      nowMs: t0 + 90_000,
      todoItems: samplePlans[0].todos.items,
    });
    expect(later.timing?.totalElapsedMs).toBe(90_000);
    expect(later.timing?.currentStageElapsedMs).toBe(90_000);

    const midPlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 1,
        pending: 1,
        inProgress: 1,
        items: [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" as const },
          { id: "narrow-plugin-shell", content: "Shell", status: "in_progress" as const },
          { id: "now-execution-panel", content: "Now", status: "pending" as const },
        ],
      },
    };
    const switched = buildCurrentExecution([midPlan], handoff);
    const afterSwitch = observeMissionTiming(later.ledger, switched, {
      nowMs: t0 + 120_000,
      todoItems: midPlan.todos.items,
    });
    expect(afterSwitch.timing?.currentStageId).toBe("narrow-plugin-shell");
    expect(afterSwitch.timing?.currentStageElapsedMs).toBe(0);
    expect(afterSwitch.timing?.totalElapsedMs).toBe(120_000);
    const prior = afterSwitch.timing?.stages?.find((s) => s.id === "semantic-snapshot-model");
    expect(prior?.elapsedMs).toBe(120_000);
    expect(prior?.status).toBe("completed");
  });

  it("freezes totals when status is completed", () => {
    const live = buildCurrentExecution(samplePlans, handoff);
    const started = observeMissionTiming(emptyMissionTimingLedger(), live, {
      nowMs: t0,
      todoItems: samplePlans[0].todos.items,
    });
    const running = observeMissionTiming(started.ledger, live, {
      nowMs: t0 + 60_000,
      todoItems: samplePlans[0].todos.items,
    });
    const donePlan = {
      ...samplePlans[0],
      todos: {
        total: 3,
        completed: 3,
        pending: 0,
        inProgress: 0,
        items: [
          { id: "semantic-snapshot-model", content: "Done", status: "completed" as const },
          { id: "narrow-plugin-shell", content: "Done", status: "completed" as const },
          { id: "now-execution-panel", content: "Done", status: "completed" as const },
        ],
      },
    };
    const completed = buildCurrentExecution([donePlan], {
      ...handoff,
      mode: "STOPPED (plan exhausted)",
    });
    const frozen = observeMissionTiming(running.ledger, completed, {
      nowMs: t0 + 90_000,
      todoItems: donePlan.todos.items,
    });
    expect(frozen.timing?.frozenAt).toBe("2026-07-26T12:01:30.000Z");
    expect(frozen.timing?.totalElapsedMs).toBe(90_000);
    const still = observeMissionTiming(frozen.ledger, completed, {
      nowMs: t0 + 180_000,
      todoItems: donePlan.todos.items,
    });
    expect(still.timing?.totalElapsedMs).toBe(90_000);
    expect(still.timing?.frozenAt).toBe(frozen.timing?.frozenAt);
  });

  it("resets timing when planFile changes", () => {
    const a = buildCurrentExecution(samplePlans, handoff);
    const started = observeMissionTiming(emptyMissionTimingLedger(), a, {
      nowMs: t0,
      todoItems: samplePlans[0].todos.items,
    });
    const other = {
      ...samplePlans[1],
      todos: {
        total: 2,
        completed: 0,
        pending: 1,
        inProgress: 1,
        items: [
          { id: "sec-xss", content: "XSS", status: "in_progress" as const },
          { id: "sec-cors", content: "CORS", status: "pending" as const },
        ],
      },
    };
    const b = buildCurrentExecution([other], {
      plan: "mission-control-hardening.plan.md",
      mode: "run-plan",
      parkedPlans: [],
    });
    const switched = observeMissionTiming(started.ledger, b, {
      nowMs: t0 + 30_000,
      todoItems: other.todos.items,
    });
    expect(switched.timing?.totalElapsedMs).toBe(0);
    expect(switched.timing?.currentStageId).toBe("sec-xss");
    expect(Object.keys(switched.ledger.missions)).toContain("mission-control-plugin-ux.plan.md");
    expect(Object.keys(switched.ledger.missions)).toContain("mission-control-hardening.plan.md");
  });

  it("parseMissionTimingLedger tolerates malformed input", () => {
    expect(parseMissionTimingLedger(null).missions).toEqual({});
    expect(parseMissionTimingLedger({ version: 1, missions: "nope" }).missions).toEqual({});
  });

  it("buildMissionControlView attaches timing on executing now", () => {
    const view = buildMissionControlView({
      plans: samplePlans,
      handoff,
      nowMs: t0,
      timingLedger: emptyMissionTimingLedger(),
    });
    expect(view.now.totalElapsedMs).toBe(0);
    expect(view.now.currentStageId).toBe("semantic-snapshot-model");
    expect(view.now.timingStartedAt).toBe("2026-07-26T12:00:00.000Z");
    expect(view.now.planFile).toBe("mission-control-plugin-ux.plan.md");
    expect(view.timingLedger.missions["mission-control-plugin-ux.plan.md"]).toBeTruthy();
  });
});

describe("Field Report activity review cadence", () => {
  const completedPlan = {
    id: "finished-widget",
    file: "finished-widget.plan.md",
    path: ".cursor/plans/finished-widget.plan.md",
    overview: "Done",
    todos: {
      total: 1,
      completed: 1,
      pending: 0,
      inProgress: 0,
      items: [{ id: "a", content: "ship", status: "completed" }],
    },
  };

  it("accepts cadence attention ids", () => {
    expect(isFieldReportAttentionId("attention:cadence:w-20260727120000")).toBe(true);
    expect(isFieldReportAttentionId("attention:cadence:bad id")).toBe(false);
  });

  it("bumps ticks and opens a warning at threshold when unreviewed work exists", () => {
    let ledger = emptyCadenceLedger();
    const targets = [{ planFile: "finished-widget.plan.md" }];
    ledger = recordCadenceTickClose(ledger, { tickThreshold: 3, unreviewedTargets: targets });
    ledger = recordCadenceTickClose(ledger, { tickThreshold: 3, unreviewedTargets: targets });
    expect(ledger.activeWarningId).toBeNull();
    ledger = recordCadenceTickClose(ledger, { tickThreshold: 3, unreviewedTargets: targets });
    expect(ledger.ticksSinceClear).toBe(3);
    expect(ledger.activeWarningId).toMatch(/^attention:cadence:w-/);
    expect(ledger.pendingPlanFiles).toEqual(["finished-widget.plan.md"]);
  });

  it("batch-complete opens a warning immediately when unreviewed work exists", () => {
    const ledger = recordCadenceBatchComplete(emptyCadenceLedger(), {
      unreviewedTargets: [{ planFile: "finished-widget.plan.md" }],
      nowIso: "2026-07-27T15:00:00.000Z",
    });
    expect(ledger.lastBatchCompleteAt).toBe("2026-07-27T15:00:00.000Z");
    expect(ledger.activeWarningId).toMatch(/^attention:cadence:/);
  });

  it("lists terminal plans without monitors as unreviewed owed targets", () => {
    const targets = listUnreviewedReviewTargets([completedPlan], null, [], []);
    expect(targets.some((t) => t.kind === "owed" && t.planFile === "finished-widget.plan.md")).toBe(
      true,
    );
  });

  it("does not count terminal plans with an already-triaged monitor as owed", () => {
    const triaged = parseExternalReport({
      file: "plan-monitor-finished-widget.md",
      content: [
        "# Monitor log - finished-widget",
        "",
        "**Plan:** [`finished-widget.plan.md`](../plans/finished-widget.plan.md)",
        "",
        "## Full review",
        "",
        "Outcome: shipped.",
        "",
        "## Triage note",
        "",
        "- **Date:** 2026-07-27",
        "- **Choice:** Ack and stop",
        "- **Summary:** clean",
      ].join("\n"),
      modifiedAt: "2026-07-27T12:00:00.000Z",
    });
    expect(triaged).toBeTruthy();
    const targets = listUnreviewedReviewTargets([completedPlan], null, [triaged], []);
    expect(targets.some((t) => t.planFile === "finished-widget.plan.md")).toBe(false);
    expect(targets.some((t) => t.kind === "owed")).toBe(false);
  });

  it("builds batch paste command and cadence attention item", () => {
    const targets = [
      {
        planFile: "finished-widget.plan.md",
        slug: "finished-widget",
        path: ".cursor/plans/finished-widget.plan.md",
        kind: "owed",
      },
      {
        planFile: "another-long-plan-name-for-batch.plan.md",
        slug: "another-long-plan-name-for-batch",
        path: ".cursor/plans/another-long-plan-name-for-batch.plan.md",
        kind: "owed",
      },
    ];
    const batch = buildBatchExternalReviewPasteCommand(targets);
    expect(batch).toContain("--batch");
    expect(batch).toContain("--paste-only");
    expect(batch).toContain("finished-widget.plan.md");
    expect(batch).toContain("another-long-plan-name-for-batch.plan.md");
    // Long multi-plan shell lines must stay intact for data-copy-* (not onclick literals).
    expect(batch?.length).toBeGreaterThan(80);

    const ledger = recordCadenceBatchComplete(emptyCadenceLedger(), {
      unreviewedTargets: targets,
    });
    const item = buildCadenceAttentionItem(ledger, targets, { enabled: true });
    expect(item?.kind).toBe("cadence");
    expect(item?.severity).toBe("warning");
    expect(item?.action?.pasteDestination).toBe("terminal");
    expect(item?.action?.target).toBe(batch);
    expect(item?.action?.label).toBe("Copy batch external review");
    expect(Array.isArray(item?.secondaryActions)).toBe(true);
    expect(item?.secondaryActions?.length).toBe(2);
    expect(item?.secondaryActions?.[0]?.pasteDestination).toBe("terminal");
    expect(item?.secondaryActions?.[0]?.label).toMatch(/^Copy review:/);
    expect(item?.resolveAction?.pasteDestination).toBe("chatInput");
    expect(item?.resolveAction?.target).toContain("/field-report-resolve attention:cadence:");
  });

  it("buildAttentionItems emits cadence when ledger has an active warning", () => {
    const ledger = recordCadenceBatchComplete(emptyCadenceLedger(), {
      unreviewedTargets: [{ planFile: "finished-widget.plan.md" }],
    });
    const items = buildAttentionItems({
      plans: [completedPlan],
      handoff: null,
      externalReports: [],
      cadenceLedger: ledger,
      cadenceConfig: { enabled: true, tickThreshold: 3 },
    });
    expect(items.some((i) => i.kind === "cadence")).toBe(true);
  });

  it("clear resets the window; parseCadenceLedger and config defaults are safe", () => {
    expect(parseFieldReportReviewCadenceConfig(null)).toEqual({
      enabled: true,
      tickThreshold: 3,
    });
    expect(parseCadenceLedger(null).ticksSinceClear).toBe(0);
    const cleared = clearCadenceWarning({
      version: 1,
      ticksSinceClear: 9,
      activeWarningId: "attention:cadence:w-1",
      windowId: "w-1",
      pendingPlanFiles: ["x.plan.md"],
      lastBatchCompleteAt: null,
    });
    expect(cleared.activeWarningId).toBeNull();
    expect(cleared.ticksSinceClear).toBe(0);
  });
});

describe("Flight Log Gaps history ledger", () => {
  it("exports ledger path and past cap", () => {
    expect(FLIGHT_LOG_LEDGER_REL).toBe(".cursor/context/flight-log.json");
    expect(FLIGHT_LOG_PAST_CAP).toBe(15);
    expect(emptyFlightLogLedger()).toEqual({
      version: 1,
      lastCurrent: null,
      past: [],
      flightKey: null,
    });
  });

  it("builds flight keys for plan and run-plan-all queue", () => {
    expect(buildFlightLogFlightKey({ plan: "a.plan.md", mode: "manual" })).toBe("plan:a.plan.md");
    expect(buildFlightLogFlightKey({ plan: null, mode: "manual" })).toBe("plan:none");
    expect(
      buildFlightLogFlightKey({
        plan: "b.plan.md",
        mode: "run-plan-all",
        runQueue: ["a.plan.md", "b.plan.md"],
      }),
    ).toBe("queue:a.plan.md,b.plan.md#b.plan.md");
  });

  it("appends prior Gaps when live value changes and caps past", () => {
    const t0 = Date.parse("2026-07-27T12:00:00.000Z");
    const flightKey = "plan:demo.plan.md";
    let { ledger, flightLog } = observeFlightLog(null, "first gap", {
      nowMs: t0,
      flightKey,
    });
    expect(flightLog.current).toBe("first gap");
    expect(flightLog.currentKind).toBe("residual");
    expect(flightLog.past).toEqual([]);
    expect(ledger.lastCurrent).toBe("first gap");
    expect(ledger.flightKey).toBe(flightKey);

    ({ ledger, flightLog } = observeFlightLog(ledger, "second gap", {
      nowMs: t0 + 1000,
      flightKey,
    }));
    expect(flightLog.current).toBe("second gap");
    expect(flightLog.currentKind).toBe("residual");
    expect(flightLog.past).toHaveLength(1);
    expect(flightLog.past[0]?.text).toBe("first gap");
    expect(flightLog.past[0]?.kind).toBe("residual");

    ({ ledger, flightLog } = observeFlightLog(ledger, null, {
      nowMs: t0 + 2000,
      flightKey,
    }));
    expect(flightLog.current).toBeNull();
    expect(flightLog.currentKind).toBe("ok");
    expect(flightLog.past[0]?.text).toBe("second gap");
    expect(flightLog.past[1]?.text).toBe("first gap");

    // Identical consecutive does not duplicate.
    ({ ledger, flightLog } = observeFlightLog(ledger, null, {
      nowMs: t0 + 3000,
      flightKey,
    }));
    expect(flightLog.past).toHaveLength(2);

    let next = ledger;
    for (let i = 0; i < 20; i++) {
      ({ ledger: next } = observeFlightLog(next, `g-${i}`, {
        nowMs: t0 + 4000 + i,
        flightKey,
      }));
    }
    expect(parseFlightLogLedger(next).past.length).toBeLessThanOrEqual(FLIGHT_LOG_PAST_CAP);
  });

  it("wipes past and lastCurrent seed on flight boundary", () => {
    const t0 = Date.parse("2026-07-28T01:00:00.000Z");
    let { ledger, flightLog } = observeFlightLog(null, "old flight gap", {
      nowMs: t0,
      flightKey: "plan:old.plan.md",
    });
    ({ ledger, flightLog } = observeFlightLog(ledger, "newer in old", {
      nowMs: t0 + 1000,
      flightKey: "plan:old.plan.md",
    }));
    expect(flightLog.past).toHaveLength(1);
    expect(flightLog.past[0]?.text).toBe("old flight gap");

    ({ ledger, flightLog } = observeFlightLog(ledger, "fresh flight", {
      nowMs: t0 + 2000,
      flightKey: "plan:new.plan.md",
    }));
    expect(ledger.flightKey).toBe("plan:new.plan.md");
    expect(flightLog.current).toBe("fresh flight");
    expect(flightLog.past).toEqual([]);
    expect(ledger.lastCurrent).toBe("fresh flight");

    // Transition to Plan: none also wipes.
    ({ ledger, flightLog } = observeFlightLog(ledger, "idle note", {
      nowMs: t0 + 3000,
      flightKey: "plan:none",
    }));
    expect(flightLog.past).toEqual([]);
    expect(flightLog.current).toBe("idle note");

    // Queue start (new queue id) wipes even with same plan basename.
    ({ ledger } = observeFlightLog(ledger, "q1", {
      nowMs: t0 + 4000,
      flightKey: "queue:a.plan.md#a.plan.md",
    }));
    ({ ledger, flightLog } = observeFlightLog(ledger, "q2", {
      nowMs: t0 + 5000,
      flightKey: "queue:a.plan.md,b.plan.md#a.plan.md",
    }));
    expect(flightLog.past).toEqual([]);
    expect(flightLog.current).toBe("q2");
  });

  it("attaches flightLog on buildMissionControlView", () => {
    const view = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
        gaps: "blocked on review",
      },
      flightLogLedger: {
        version: 1,
        lastCurrent: "older gap",
        past: [],
        flightKey: "plan:mission-control-plugin-ux.plan.md",
      },
      nowMs: Date.parse("2026-07-27T15:00:00.000Z"),
    });
    expect(view.flightLog.current).toBe("blocked on review");
    expect(view.flightLog.past[0]?.text).toBe("older gap");
    expect(view.flightLogLedger.lastCurrent).toBe("blocked on review");
    expect(view.flightLogLedger.flightKey).toBe("plan:mission-control-plugin-ux.plan.md");
    expect(view.now.gaps).toBe("blocked on review");
    expect(view.flightLog.warnings).toEqual([]);
  });

  it("buildMissionControlView wipes ledger when plan basename changes", () => {
    const view = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
        gaps: "on new plan",
      },
      flightLogLedger: {
        version: 1,
        lastCurrent: "prior flight residual",
        past: [
          {
            text: "ancient gap",
            at: "2026-07-27T10:00:00.000Z",
            sourcePath: ".cursor/HANDOFF.md",
          },
        ],
        flightKey: "plan:other.plan.md",
      },
      nowMs: Date.parse("2026-07-28T02:00:00.000Z"),
    });
    expect(view.flightLog.current).toBe("on new plan");
    expect(view.flightLog.past).toEqual([]);
    expect(view.flightLogLedger.past).toEqual([]);
    expect(view.flightLogLedger.flightKey).toBe("plan:mission-control-plugin-ux.plan.md");
  });

  it("surfaces API/usage and heads-up Warnings without cadence/review kinds", () => {
    expect(FLIGHT_LOG_WARNINGS_CAP).toBe(5);
    const api = buildFlightLogWarnings({
      mode: "run-plan (orchestrated) — STOPPED: API/usage limit",
      gaps: "API/usage limit; resume after named model",
      instruction: "Recover with named model then /continue-plan",
    });
    expect(api).toHaveLength(1);
    expect(api[0]?.kind).toBe("api_limit");
    expect(api[0]?.title).toBe("Quota pause");
    expect(api[0]?.text).toContain("API/usage limit");

    const heads = buildFlightLogWarnings({
      mode: "manual",
      gaps: "Heads up: context almost full; prefer handoff",
      instruction: "Open a new conversation",
    });
    expect(heads).toHaveLength(1);
    expect(heads[0]?.kind).toBe("orchestrator_heads_up");
    expect(heads[0]?.title).toBe("Heads up");

    const none = buildFlightLogWarnings({
      mode: "run-plan (orchestrated)",
      gaps: "none",
      instruction: "Continue next to-do",
    });
    expect(none).toEqual([]);

    // Cadence / FR attention ids must not appear as Flight Log warning kinds.
    const kinds = [...api, ...heads].map((w) => w.kind);
    expect(kinds).not.toContain("cadence");
    expect(kinds).not.toContain("external_report");
    expect(kinds).not.toContain("agent_prompt");

    const view = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "run-plan (orchestrated) — STOPPED: API/usage limit",
        gaps: "API/usage limit; cursor on phase-2",
      },
      cadenceLedger: {
        version: 1,
        ticksSinceClear: 9,
        activeWarningId: "attention:cadence:w-test",
        windowId: "w-test",
        pendingPlanFiles: ["x.plan.md"],
      },
      nowMs: Date.parse("2026-07-28T01:00:00.000Z"),
    });
    expect(view.flightLog.warnings.some((w) => w.kind === "api_limit")).toBe(true);
    // Cadence still builds attention for scripts; Flight Log warnings stay separate.
    expect(view.flightLog.warnings.every((w) => w.kind !== "cadence")).toBe(true);
    expect(view.attention.some((a) => a.kind === "cadence")).toBe(true);
  });
});

describe("listFlightLogQuietOpenTriages", () => {
  it("surfaces report rows only and caps the quiet list", () => {
    const attention = [
      {
        id: "attention:report:a",
        kind: "report",
        label: "a awaiting triage",
        sourcePath: ".cursor/memory/plan-monitor-a.md",
      },
      {
        id: "attention:cadence:w-1",
        kind: "cadence",
        label: "Cadence",
        sourcePath: ".cursor/context/field-report-cadence.json",
      },
      {
        id: "attention:prompt:x",
        kind: "prompt",
        label: "Prompt",
        sourcePath: ".cursor/context/field-report-prompts.json",
      },
      {
        id: "attention:report:b",
        kind: "report",
        label: "b awaiting triage",
        sourcePath: ".cursor/memory/plan-monitor-b.md",
      },
      { id: "attention:report:no-path", kind: "report", label: "orphan" },
    ];
    const rows = listFlightLogQuietOpenTriages(attention);
    expect(rows.map((r) => r.id)).toEqual(["attention:report:a", "attention:report:b"]);
    expect(FLIGHT_LOG_QUIET_OPEN_TRIAGES_CAP).toBe(5);
  });

  it("attaches quietOpenTriages on flightLog for quiet+debt vs quiet+clear", () => {
    const debtReport = parseExternalReport({
      file: "plan-monitor-widget-rollout.md",
      content:
        "# Monitor log - widget-rollout\n\n**Plan:** `widget-rollout.plan.md`\n\n### Residual items for human attention\n\n1. Fix the live blocker.\n",
      modifiedAt: "2026-07-28T12:00:00.000Z",
    });
    const debt = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
      },
      externalReports: [debtReport],
      nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
    });
    expect(debt.flightLog.current).toBeNull();
    expect(debt.flightLog.warnings).toEqual([]);
    expect(debt.flightLog.quietOpenTriages.length).toBeGreaterThan(0);
    expect(debt.flightLog.quietOpenTriages[0].kind).toBe("report");
    expect(debt.flightLog.quietOpenTriages[0].action?.target).toContain("/plan-review-triage");

    const clear = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
      },
      externalReports: [],
      nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
    });
    expect(clear.flightLog.quietOpenTriages).toEqual([]);

    // Gaps present: quietOpenTriages still built for snapshot, but UI must not
    // mix them into the Gaps stack (render gate is Gaps/Warnings empty).
    const withGaps = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
        gaps: "Enqueue residuals for F1",
      },
      externalReports: [debtReport],
      nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
    });
    expect(withGaps.flightLog.current).toBeTruthy();
    expect(withGaps.flightLog.quietOpenTriages.length).toBeGreaterThan(0);
  });

  it("does not starve quietOpenTriages when attention drops reports under a tight limit", () => {
    const debtReport = parseExternalReport({
      file: "plan-monitor-widget-rollout.md",
      content:
        "# Monitor log - widget-rollout\n\n**Plan:** `widget-rollout.plan.md`\n\n### Residual items for human attention\n\n1. Fix the live blocker.\n",
      modifiedAt: "2026-07-28T12:00:00.000Z",
    });
    const agentPrompts = Array.from({ length: 20 }, (_, i) => ({
      chatId: `chat-starve-${i}`,
      label: `Pending question ${i}?`,
    }));
    const starvedAttention = buildAttentionItems({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
      },
      agentPrompts,
      externalReports: [debtReport],
      limit: 3,
    });
    expect(starvedAttention.some((a) => a.kind === "report")).toBe(false);
    expect(listFlightLogQuietOpenTriages(starvedAttention)).toEqual([]);

    const view = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
      },
      agentPrompts,
      externalReports: [debtReport],
      nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
    });
    expect(view.flightLog.quietOpenTriages.length).toBeGreaterThan(0);
    expect(view.flightLog.quietOpenTriages[0].kind).toBe("report");
    expect(view.flightLogQuietOpenTriagesCap).toBe(FLIGHT_LOG_QUIET_OPEN_TRIAGES_CAP);
  });
});

describe("Flight Log composed action commands", () => {
  it("Gaps NOW carries a Copy fix prompt action with the HANDOFF path", () => {
    const { flightLog } = observeFlightLog(null, "Enqueue residuals for F1", {
      nowMs: Date.parse("2026-07-28T01:00:00.000Z"),
      sourcePath: ".cursor/HANDOFF.md",
    });
    expect(flightLog.currentAction?.label).toBe("Copy fix prompt");
    expect(flightLog.currentAction?.sourcePath).toBe(".cursor/HANDOFF.md");
    expect(flightLog.currentAction?.command).toBe(
      "Act on these open residuals:\nEnqueue residuals for F1\n.cursor/HANDOFF.md",
    );
  });

  it("Gaps NOW action is null when there are no live gaps", () => {
    const { flightLog } = observeFlightLog(null, null, {
      nowMs: Date.parse("2026-07-28T01:00:00.000Z"),
    });
    expect(flightLog.current).toBeNull();
    expect(flightLog.currentAction).toBeNull();
  });

  it("Gaps Earlier entries carry a Copy fix prompt action with the entry sourcePath", () => {
    const { ledger } = observeFlightLog(null, "first gap", {
      nowMs: Date.parse("2026-07-28T01:00:00.000Z"),
      sourcePath: ".cursor/HANDOFF.md",
    });
    const { flightLog } = observeFlightLog(ledger, "second gap", {
      nowMs: Date.parse("2026-07-28T02:00:00.000Z"),
      sourcePath: ".cursor/HANDOFF.md",
    });
    expect(flightLog.past).toHaveLength(1);
    const earlier = flightLog.past[0];
    expect(earlier.action?.label).toBe("Copy fix prompt");
    expect(earlier.action?.sourcePath).toBe(".cursor/HANDOFF.md");
    expect(earlier.action?.command).toBe(
      "Act on these earlier residuals:\nfirst gap\n.cursor/HANDOFF.md",
    );
  });

  it("api_limit warning carries a Copy recovery prompt action", () => {
    const warnings = buildFlightLogWarnings({
      mode: "run-plan (orchestrated) — STOPPED: API/usage limit",
      gaps: "API/usage limit; cursor on phase-2",
      instruction: "",
    });
    const w = warnings.find((x) => x.kind === "api_limit");
    expect(w?.action?.label).toBe("Copy recovery prompt");
    expect(w?.action?.sourcePath).toBe(".cursor/HANDOFF.md");
    expect(w?.action?.command).toContain("Resume after this quota pause:");
    expect(w?.action?.command.endsWith("\n.cursor/HANDOFF.md")).toBe(true);
  });

  it("orchestrator_heads_up warning carries a Copy follow-up prompt action", () => {
    const warnings = buildFlightLogWarnings({
      mode: "manual",
      gaps: "Heads up: rebalance the queue before the next tick",
      instruction: "",
    });
    const w = warnings.find((x) => x.kind === "orchestrator_heads_up");
    expect(w?.action?.label).toBe("Copy follow-up prompt");
    expect(w?.action?.sourcePath).toBe(".cursor/HANDOFF.md");
    expect(w?.action?.command).toContain("Act on this heads-up:");
    expect(w?.action?.command.endsWith("\n.cursor/HANDOFF.md")).toBe(true);
  });

  it("quiet open-triage rows carry the slash-command payload with monitor sourcePath", () => {
    const report = parseExternalReport({
      file: "plan-monitor-widget-rollout.md",
      content:
        "# Monitor log - widget-rollout\n\n**Plan:** `widget-rollout.plan.md`\n\n### Residual items for human attention\n\n1. Fix the live blocker.\n",
      modifiedAt: "2026-07-28T12:00:00.000Z",
    });
    const view = buildMissionControlView({
      plans: samplePlans,
      handoff: {
        plan: "mission-control-plugin-ux.plan.md",
        mode: "manual",
      },
      externalReports: [report],
      nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
    });
    const row = view.flightLog.quietOpenTriages[0];
    expect(row.action?.label).toBe("Copy triage command");
    expect(row.action?.pasteDestination).toBe("chatInput");
    expect(row.action?.sourcePath).toBe(row.sourcePath);
    expect(row.action?.command).toBe(`/plan-review-triage ${row.sourcePath}`);
  });
});

describe("describeProcess", () => {
  it("narrates the dashboard server, with its port when present", () => {
    expect(
      describeProcess({
        label: "dashboard-server",
        command: "node dashboard/serve.mjs --port 3333",
        cpu: "0.2",
        etime: "02:10:11",
      }),
    ).toBe("Serving the Mission Control dashboard on port 3333 (idle, 0.2% CPU, up 02:10:11).");
    expect(
      describeProcess({ label: "dashboard-server", command: "node dashboard/serve.mjs" }),
    ).toBe("Serving the Mission Control dashboard.");
  });

  it("narrates git operations by subcommand", () => {
    expect(describeProcess({ label: "git", command: "git push origin staging", cpu: "12.5" })).toBe(
      "Pushing commits to the remote (active, 12.5% CPU).",
    );
    expect(describeProcess({ label: "git", command: "git bisect start", cpu: "0.0" })).toBe(
      "Running git bisect (idle, 0.0% CPU).",
    );
  });

  it("narrates node scripts by file name", () => {
    expect(
      describeProcess({
        label: "node",
        command: "node /tmp/scripts/build.mjs --watch",
        cpu: "55.0",
      }),
    ).toBe("Running the build.mjs Node script (busy, 55.0% CPU).");
    expect(describeProcess({ label: "node", command: "node", cpu: "1.0" })).toBe(
      "Running a Node.js process (idle, 1.0% CPU).",
    );
  });

  it("falls back to package runners and binary names for other processes", () => {
    expect(describeProcess({ label: "other", command: "pnpm vitest run", cpu: "30.0" })).toBe(
      "Running pnpm vitest (active, 30.0% CPU).",
    );
    expect(describeProcess({ label: "other", command: "/usr/bin/SCREEN -dmS audit bash" })).toBe(
      "Running SCREEN.",
    );
  });

  it("degrades gracefully on empty input and caps long narrations", () => {
    expect(describeProcess({})).toBe("Running an unrecognized process.");
    expect(describeProcess(null)).toBe("Running an unrecognized process.");
    const long = describeProcess({
      label: "node",
      command: `node /tmp/${"a".repeat(200)}.mjs`,
    });
    expect(long.endsWith("\u2026")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(161);
  });
});
