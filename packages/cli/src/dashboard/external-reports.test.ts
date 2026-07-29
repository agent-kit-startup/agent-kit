import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FINDINGS_SUMMARY_EMPTY,
  MAX_EXTERNAL_REPORTS,
  MAX_FINDINGS_SUMMARY,
  MAX_SEMANTIC_LABEL,
  buildExternalReportItems,
  buildMissionControlView,
  extractFindingsSummary,
  fieldReportTriageAllAction,
  isPlanLifecycleTerminal,
  isReportDemotedByPlanLifecycle,
  isReportTriaged,
  parseExternalReport,
  reportHasOpenReviewGaps,
  resolvePlanLifecycle,
} from "../../../../dashboard/lib/semantic-model.mjs";

const planReviewTriageCmd = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../.cursor/commands/plan-review-triage.md",
  ),
  "utf8",
);

// Synthetic report bodies only, shaped after the real
// `.cursor/memory/plan-monitor-*.md` headers and headings.
function reportBody(planFile: string, extra = "") {
  return [
    `# Monitor log - ${planFile.replace(/\.plan\.md$/, "")}`,
    "",
    `**Plan:** [\`${planFile}\`](../plans/${planFile})`,
    "**Monitor started:** 2026-07-24 (external plan review after `/run-plan` exhaustion)",
    "",
    "## Full review - plan termination",
    "",
    "Outcome: all to-dos map to shipped work.",
    extra,
  ].join("\n");
}

function report(file: string, planFile: string, extra = "", modifiedAt?: string) {
  return parseExternalReport({
    file,
    content: reportBody(planFile, extra),
    modifiedAt: modifiedAt ?? "2026-07-25T10:00:00.000Z",
  });
}

function plan(id: string, overview = "") {
  return { id, file: `${id}.plan.md`, path: `.cursor/plans/${id}.plan.md`, overview };
}

describe("parseExternalReport", () => {
  it("reads the slug and the reviewed plan out of the report header", () => {
    const parsed = report("plan-monitor-widget-rollout.md", "widget_rollout_9f21.plan.md");
    expect(parsed).toMatchObject({
      file: "plan-monitor-widget-rollout.md",
      path: ".cursor/memory/plan-monitor-widget-rollout.md",
      slug: "widget-rollout",
      reviewedPlanFile: "widget_rollout_9f21.plan.md",
      triageNoteInReport: false,
      modifiedAt: "2026-07-25T10:00:00.000Z",
    });
  });

  it("ignores files that are not reports and survives a missing header", () => {
    expect(parseExternalReport({ file: "_index.md", content: "# Index" })).toBeNull();
    expect(parseExternalReport({ file: "loop-review-findings.md", content: "" })).toBeNull();
    const headerless = parseExternalReport({
      file: "plan-monitor-bare.md",
      content: "# Monitor log",
    });
    expect(headerless?.reviewedPlanFile).toBeNull();
    expect(headerless?.slug).toBe("bare");
  });
});

describe("extractFindingsSummary", () => {
  it("prefers numbered Residual items, capped at three bullets", () => {
    const body = [
      "# Monitor log - widget",
      "",
      "## Full review - plan termination",
      "",
      "**Outcome:** Should not win over residual items.",
      "",
      "### Residual items for human attention (none are severe; none block)",
      "",
      "1. **Refresh** `.cursor/HANDOFF.md` - it names merged work as pending.",
      "2. Correct the changelog line about sub-1024px layouts.",
      "3. Reconcile the plan document region map.",
      "4. A fourth item that must be dropped by the cap.",
      "",
      "### On the monitor's own method",
      "",
      "Post-hoc review.",
    ].join("\n");
    const summary = extractFindingsSummary(body);
    expect(summary).toBe(
      "Refresh .cursor/HANDOFF.md - it names merged work as pending. • Correct the changelog line about sub-1024px layouts. • Reconcile the plan document region map.",
    );
    expect(summary).not.toContain("fourth item");
  });

  it("falls back to the Standing finding paragraph when no residual items exist", () => {
    const body = [
      "# Monitor log - widget",
      "",
      "## Standing findings - not owned by any to-do",
      "",
      "The HANDOFF is stale at HEAD and points at already-merged work.",
      "",
      "More detail in a second paragraph that is not taken.",
      "",
      "## Full review",
      "",
      "**Outcome:** Ignored because standing finding wins.",
    ].join("\n");
    expect(extractFindingsSummary(body)).toBe(
      "The HANDOFF is stale at HEAD and points at already-merged work.",
    );
  });

  it("falls back to the Full-review Outcome when neither residual nor standing exist", () => {
    const body = [
      "# Monitor log - widget",
      "",
      "## Full review - plan termination (2026-07-26, HEAD abc123)",
      "",
      "**Outcome:** The plan shipped cleanly with one documentation gap.",
      "",
      "### Acceptance checklist",
    ].join("\n");
    expect(extractFindingsSummary(body)).toBe(
      "The plan shipped cleanly with one documentation gap.",
    );
  });

  it("returns the stable empty fallback when no findings section is present", () => {
    expect(extractFindingsSummary("# Monitor log\n\nNo structured sections.\n")).toBe(
      FINDINGS_SUMMARY_EMPTY,
    );
    expect(extractFindingsSummary("")).toBe(FINDINGS_SUMMARY_EMPTY);
    expect(extractFindingsSummary(undefined as unknown as string)).toBe(FINDINGS_SUMMARY_EMPTY);
  });

  it("caps the summary length with an ellipsis", () => {
    const long = Array.from({ length: 3 }, (_, i) => `${i + 1}. ${"word ".repeat(60).trim()}`).join(
      "\n",
    );
    const body = ["### Residual items for human attention", "", long].join("\n");
    const summary = extractFindingsSummary(body);
    expect(summary.length).toBeLessThanOrEqual(MAX_FINDINGS_SUMMARY + 1);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("keeps dangerous characters as plain text for the renderer to escape", () => {
    const body = [
      "### Residual items for human attention",
      "",
      '1. Watch <script>alert(1)</script> & "quotes".',
    ].join("\n");
    const summary = extractFindingsSummary(body);
    expect(summary).toContain("<script>");
    expect(summary).toContain("&");
  });

  it("is carried on parseExternalReport and shapeExternalReportItem", () => {
    const parsed = report(
      "plan-monitor-widget-rollout.md",
      "widget-rollout.plan.md",
      "\n### Residual items for human attention\n\n1. Refresh the HANDOFF.\n",
    );
    expect(parsed?.findingsSummary).toBe("Refresh the HANDOFF.");
    const [item] = buildExternalReportItems([parsed], []);
    expect(item.findingsSummary).toBe("Refresh the HANDOFF.");

    const noSection = report("plan-monitor-bare2.md", "bare2.plan.md", "");
    // The default reportBody carries a Full review Outcome line.
    expect(noSection?.findingsSummary).toBe("all to-dos map to shipped work.");
  });
});

describe("/plan-review-triage triage heading contract", () => {
  it("requires a durable triage heading for every outcome including Ack and stop", () => {
    expect(planReviewTriageCmd).toContain("Persist a durable triage heading");
    expect(planReviewTriageCmd).toContain("## Triage note");
    expect(planReviewTriageCmd).toMatch(/Ack and stop[\s\S]*must write the heading/i);
    expect(planReviewTriageCmd).toContain("Never skip the triage heading");
  });

  it("requires Broad Intake before Write residuals propose + write-confirm", () => {
    expect(planReviewTriageCmd).toContain("Never skip Broad Intake");
    expect(planReviewTriageCmd).toMatch(
      /Broad Intake[\s\S]*Write plan to backlog[\s\S]*Modify proposal first[\s\S]*Cancel/i,
    );
  });
});

describe("isReportTriaged", () => {
  it("treats a report with no triage note and no follow-up plan as untriaged", () => {
    const parsed = report("plan-monitor-widget-rollout.md", "widget-rollout.plan.md");
    expect(isReportTriaged(parsed, [plan("widget-rollout"), plan("unrelated-work")])).toBe(false);
  });

  it("excludes a report that already produced a plan", () => {
    const parsed = report("plan-monitor-widget-rollout.md", "widget_rollout.plan.md");
    const plans = [
      plan("widget_rollout"),
      plan(
        "widget_residuals_2026_07_25",
        "Close residual gaps from the widget_rollout monitor full review.",
      ),
    ];
    expect(isReportTriaged(parsed, plans)).toBe(true);
    expect(buildExternalReportItems([parsed], plans)).toEqual([]);
  });

  it("matches a follow-up plan across the hyphen and underscore split", () => {
    const parsed = report(
      "plan-monitor-start-project-always-create-plan.md",
      "start_project_always_create_plan.plan.md",
    );
    const followUp = plan(
      "hitl_ask_questions_residuals_2026_07_20",
      "Close residual gaps from the start_project_always_create_plan monitor full review.",
    );
    expect(isReportTriaged(parsed, [followUp])).toBe(true);
  });

  it("excludes a report whose triage outcome produced only a note", () => {
    const parsed = report(
      "plan-monitor-readiness.md",
      "readiness.plan.md",
      "\n## Triage note - residual (A) verified\n\nNo code nits found.\n",
    );
    expect(isReportTriaged(parsed, [])).toBe(true);

    const followUpHeading = report(
      "plan-monitor-readiness.md",
      "readiness.plan.md",
      "\n## Follow-up plan - `residuals.plan.md` (verified, not live-monitored)\n",
    );
    expect(isReportTriaged(followUpHeading, [])).toBe(true);
  });

  it("does not treat tick headings naming triage-* to-do ids as durable triage", () => {
    const parsed = report(
      "plan-monitor-quiet-open-triages.md",
      "flight-log-quiet-open-triages.plan.md",
      "\n## Tick 1 — `adr-quiet-triage-surface` (Phase 0)\n\n### Still open\n\n| A |\n",
    );
    expect(isReportTriaged(parsed, [])).toBe(false);

    const residualsHeading = report(
      "plan-monitor-hooks.md",
      "hooks.plan.md",
      "\n## Residuals plan\n\n- **Plan:** `close-residuals.plan.md`\n",
    );
    expect(isReportTriaged(residualsHeading, [])).toBe(true);
  });

  it("does not mistake the reviewed plan for its own follow-up", () => {
    const parsed = report(
      "plan-monitor-repository-readiness-onboarding.md",
      "repository-readiness-onboarding_5c26fc3a.plan.md",
    );
    const reviewed = {
      id: "repository-readiness-onboarding_5c26fc3a",
      file: "repository-readiness-onboarding_5c26fc3a.plan.md",
      path: ".cursor/plans/repository-readiness-onboarding_5c26fc3a.plan.md",
      overview: "Make repository readiness the first useful path.",
    };
    expect(isReportTriaged(parsed, [reviewed])).toBe(false);
  });

  it("does not match a plan that only shares the product area", () => {
    const parsed = report(
      "plan-monitor-mission-control-plugin-ux.md",
      "mission-control-plugin-ux.plan.md",
    );
    const neighbour = plan(
      "mission-control-cockpit-nav",
      "Repair the broken Mission Control logo and rebuild the Cockpit sections.",
    );
    expect(isReportTriaged(parsed, [neighbour])).toBe(false);
  });
});

function planWithTodos(
  id: string,
  statuses: string[],
): {
  id: string;
  file: string;
  path: string;
  overview: string;
  todos: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    items: { id: string; content: string; status: string }[];
  };
} {
  const items = statuses.map((status, i) => ({
    id: `t${i}`,
    content: `Step ${i}`,
    status,
  }));
  return {
    id,
    file: `${id}.plan.md`,
    path: `.cursor/plans/${id}.plan.md`,
    overview: "",
    todos: {
      total: items.length,
      completed: items.filter((t) => t.status === "completed").length,
      pending: items.filter((t) => t.status === "pending").length,
      inProgress: items.filter((t) => t.status === "in_progress").length,
      items,
    },
  };
}

describe("report plan-lifecycle classification", () => {
  it("classifies a terminal reviewed plan as review debt without dropping or marking triaged", () => {
    const parsed = report("plan-monitor-done-work.md", "done-work.plan.md");
    const plans = [planWithTodos("done-work", ["completed", "completed"])];
    const handoff = { plan: "other.plan.md", parkedPlans: ["done-work.plan.md"] };
    expect(resolvePlanLifecycle("done-work.plan.md", plans, handoff)).toBe("completed");
    expect(isReportTriaged(parsed, plans)).toBe(false);
    expect(isReportDemotedByPlanLifecycle(parsed, plans, handoff)).toBe(true);
    const [item] = buildExternalReportItems([parsed], plans, { handoff });
    expect(item).toMatchObject({ id: "attention:report:done-work", group: "debt" });
    const view = buildMissionControlView({
      plans,
      handoff,
      externalReports: [parsed],
    });
    const surfaced = view.attention.find((i) => i.id === "attention:report:done-work");
    expect(surfaced).toBeDefined();
    expect(surfaced?.group).toBe("debt");
    expect(isReportTriaged(parsed, plans)).toBe(false);
  });

  it("classifies parked/exhausted reviewed plans as review debt too", () => {
    const parsed = report("plan-monitor-parked-open.md", "parked-open.plan.md");
    const plans = [planWithTodos("parked-open", ["completed", "pending"])];
    const handoff = { plan: "live.plan.md", parkedPlans: ["parked-open.plan.md"] };
    expect(resolvePlanLifecycle("parked-open.plan.md", plans, handoff)).toBe("parked");
    expect(isReportDemotedByPlanLifecycle(parsed, plans, handoff)).toBe(true);
    expect(isReportTriaged(parsed, plans)).toBe(false);
    const [item] = buildExternalReportItems([parsed], plans, { handoff });
    expect(item).toMatchObject({ id: "attention:report:parked-open", group: "debt" });
  });

  it("classifies a report whose reviewed plan is still active as blocking", () => {
    const parsed = report("plan-monitor-live-work.md", "live-work.plan.md");
    const plans = [planWithTodos("live-work", ["completed", "pending"])];
    const handoff = { plan: "live-work.plan.md", mode: "continue-plan" };
    expect(isReportDemotedByPlanLifecycle(parsed, plans, handoff)).toBe(false);
    const items = buildExternalReportItems([parsed], plans, { handoff });
    expect(items).toHaveLength(1);
    expect(items[0].group).toBe("blocking");
  });

  it("classifies a report as blocking when reviewed-plan lifecycle is unknown (absent inventory)", () => {
    const parsed = report("plan-monitor-ghost.md", "ghost.plan.md");
    const handoff = { plan: "other.plan.md" };
    expect(resolvePlanLifecycle("ghost.plan.md", [], handoff)).toBe("unknown");
    expect(isReportDemotedByPlanLifecycle(parsed, [], handoff)).toBe(false);
    const items = buildExternalReportItems([parsed], [], { handoff });
    expect(items).toHaveLength(1);
    expect(items[0].group).toBe("blocking");
  });

  it("resolves an archived plan as terminal `archived`, not `unknown`", () => {
    const parsed = report("plan-monitor-archived-work.md", "archived-work.plan.md");
    const handoff = { plan: "other.plan.md" };
    const archived = ["archived-work.plan.md"];
    expect(resolvePlanLifecycle("archived-work.plan.md", [], handoff, archived)).toBe("archived");
    expect(isPlanLifecycleTerminal("archived")).toBe(true);
    expect(isReportDemotedByPlanLifecycle(parsed, [], handoff, archived)).toBe(true);
    // Same plan without archive knowledge still resolves unknown (kept blocking).
    expect(resolvePlanLifecycle("archived-work.plan.md", [], handoff)).toBe("unknown");
    expect(isReportDemotedByPlanLifecycle(parsed, [], handoff)).toBe(false);
  });

  it("matches archive entries by basename, case-insensitively and path-formed", () => {
    const handoff = { plan: "other.plan.md" };
    expect(
      resolvePlanLifecycle("archived-work.plan.md", [], handoff, [
        ".cursor/plans/archive/Archived-Work.plan.md",
      ]),
    ).toBe("archived");
  });

  it("prefers the active inventory record over an archive entry with the same name", () => {
    const parsed = report("plan-monitor-live-work.md", "live-work.plan.md");
    const plans = [planWithTodos("live-work", ["completed", "pending"])];
    const handoff = { plan: "live-work.plan.md", mode: "continue-plan" };
    const archived = ["live-work.plan.md"];
    expect(resolvePlanLifecycle("live-work.plan.md", plans, handoff, archived)).not.toBe(
      "archived",
    );
    expect(isReportDemotedByPlanLifecycle(parsed, plans, handoff, archived)).toBe(false);
    expect(
      buildExternalReportItems([parsed], plans, { handoff, archivedPlanFiles: archived }),
    ).toHaveLength(1);
  });

  it("archiving a plan changes its review group, not its visibility", () => {
    // Archiving is routine hygiene. It must move the review from blocking to
    // review debt, never drop it and never re-enter the blocking stack as an
    // accidental `unknown`.
    const parsed = report("plan-monitor-archived-work.md", "archived-work.plan.md");
    const handoff = { plan: "other.plan.md" };
    const archived = ["archived-work.plan.md"];

    // Without archive knowledge the review is blocking (still visible).
    const beforeArchive = buildExternalReportItems([parsed], [], { handoff });
    expect(beforeArchive).toHaveLength(1);
    expect(beforeArchive[0].group).toBe("blocking");

    // Once archived, same review is still visible but classified as debt.
    const afterArchive = buildExternalReportItems([parsed], [], {
      handoff,
      archivedPlanFiles: archived,
    });
    expect(afterArchive).toHaveLength(1);
    expect(afterArchive[0].group).toBe("debt");

    const view = buildMissionControlView({
      plans: [],
      handoff,
      externalReports: [parsed],
      archivedPlanFiles: archived,
    });
    const surfaced = view.attention.find((i) => i.id === "attention:report:archived-work");
    expect(surfaced).toBeDefined();
    expect(surfaced?.group).toBe("debt");
    // Classification never implies triage.
    expect(isReportTriaged(parsed, [])).toBe(false);
  });

  it("keeps reports when the reviewed plan parses zero to-dos (FR-SAC-02)", () => {
    const parsed = report("plan-monitor-empty-plan.md", "empty-plan.plan.md");
    const plans = [planWithTodos("empty-plan", [])];
    const handoff = { plan: "other.plan.md", parkedPlans: ["empty-plan.plan.md"] };
    // Zero parsed to-dos is a parse failure signal, not terminal evidence.
    expect(resolvePlanLifecycle("empty-plan.plan.md", plans, handoff)).toBe("unknown");
    expect(isReportDemotedByPlanLifecycle(parsed, plans, handoff)).toBe(false);
    expect(buildExternalReportItems([parsed], plans, { handoff })).toHaveLength(1);
  });

  it("keeps reports that have no reviewed-plan header", () => {
    const headerless = parseExternalReport({
      file: "plan-monitor-bare.md",
      content: "# Monitor log\n\nNo plan header.\n",
      modifiedAt: "2026-07-25T10:00:00.000Z",
    });
    const plans = [planWithTodos("done-work", ["completed", "completed"])];
    const handoff = { plan: "other.plan.md", parkedPlans: ["done-work.plan.md"] };
    expect(headerless?.reviewedPlanFile).toBeNull();
    expect(isReportDemotedByPlanLifecycle(headerless, plans, handoff)).toBe(false);
    expect(buildExternalReportItems([headerless], plans, { handoff })).toHaveLength(1);
  });

  it("still clears via strong triage even when the reviewed plan is active", () => {
    const triaged = report(
      "plan-monitor-live-work.md",
      "live-work.plan.md",
      "\n## Triage note - acknowledged\n",
    );
    const plans = [planWithTodos("live-work", ["completed", "pending"])];
    const handoff = { plan: "live-work.plan.md", mode: "continue-plan" };
    expect(isReportTriaged(triaged, plans)).toBe(true);
    expect(isReportDemotedByPlanLifecycle(triaged, plans, handoff)).toBe(false);
    expect(buildExternalReportItems([triaged], plans, { handoff })).toEqual([]);
  });

  it("still honors ID-only dismissal for reports that stay after demotion rules", () => {
    const keep = report("plan-monitor-keep.md", "live-work.plan.md");
    const gone = report("plan-monitor-gone.md", "live-work.plan.md");
    const plans = [planWithTodos("live-work", ["completed", "pending"])];
    const handoff = { plan: "live-work.plan.md", mode: "continue-plan" };
    const view = buildMissionControlView({
      plans,
      handoff,
      externalReports: [keep, gone],
      dismissedIds: ["attention:report:gone"],
    });
    expect(view.attention.filter((i) => i.kind === "report").map((i) => i.id)).toEqual([
      "attention:report:keep",
    ]);
  });
});

describe("buildExternalReportItems", () => {
  it("shapes an item that names the report, when it landed, and copy path + triage", () => {
    const parsed = report(
      "plan-monitor-widget-rollout.md",
      "widget-rollout.plan.md",
      "",
      "2026-07-24T08:30:00.000Z",
    );
    const [item] = buildExternalReportItems([parsed], []);
    expect(item).toMatchObject({
      id: "attention:report:widget-rollout",
      kind: "report",
      severity: "action",
      label: "widget-rollout awaiting triage",
      sourcePath: ".cursor/memory/plan-monitor-widget-rollout.md",
      modifiedAt: "2026-07-24T08:30:00.000Z",
      pathAction: {
        type: "path",
        target: ".cursor/memory/plan-monitor-widget-rollout.md",
        label: "Copy path",
      },
      action: {
        type: "copy",
        target: "/plan-review-triage .cursor/memory/plan-monitor-widget-rollout.md",
        label: "Copy triage command",
        subject: "triage command",
        pasteDestination: "chatInput",
      },
      resolveAction: {
        type: "copy",
        target: "/field-report-resolve attention:report:widget-rollout",
        label: "Copy resolve command",
        subject: "resolve command",
        pasteDestination: "chatInput",
      },
    });
  });

  it("truncates a long derived label and caps the number of items", () => {
    const long = report("plan-monitor-widget.md", `${"x".repeat(MAX_SEMANTIC_LABEL + 50)}.plan.md`);
    const [item] = buildExternalReportItems([long], []);
    expect(item.label.length).toBeLessThanOrEqual(MAX_SEMANTIC_LABEL + 1);

    const many = Array.from({ length: MAX_EXTERNAL_REPORTS + 4 }, (_, i) =>
      report(`plan-monitor-p${i}.md`, `p${i}.plan.md`),
    );
    expect(buildExternalReportItems(many, []).length).toBe(MAX_EXTERNAL_REPORTS);
  });

  it("caps the surfaced total at 20, aligned with the snapshot read cap", () => {
    expect(MAX_EXTERNAL_REPORTS).toBe(20);
    const many = Array.from({ length: MAX_EXTERNAL_REPORTS + 6 }, (_, i) =>
      report(`plan-monitor-p${i}.md`, `p${i}.plan.md`),
    );
    expect(buildExternalReportItems(many, []).length).toBe(20);
  });

  it("orders blocking before debt, and debt oldest first", () => {
    // Two live (blocking) and two terminal (debt) reviewed plans.
    const liveA = report(
      "plan-monitor-live-a.md",
      "live-a.plan.md",
      "",
      "2026-07-25T10:00:00.000Z",
    );
    const liveB = report(
      "plan-monitor-live-b.md",
      "live-b.plan.md",
      "",
      "2026-07-24T10:00:00.000Z",
    );
    const doneOld = report(
      "plan-monitor-done-old.md",
      "done-old.plan.md",
      "",
      "2026-07-01T10:00:00.000Z",
    );
    const doneNew = report(
      "plan-monitor-done-new.md",
      "done-new.plan.md",
      "",
      "2026-07-20T10:00:00.000Z",
    );
    const plans = [
      planWithTodos("live-a", ["completed", "pending"]),
      planWithTodos("live-b", ["completed", "pending"]),
      planWithTodos("done-old", ["completed", "completed"]),
      planWithTodos("done-new", ["completed", "completed"]),
    ];
    const handoff = {
      plan: "live-a.plan.md",
      mode: "continue-plan",
      // live-b is queued (backlog, still open) so it stays blocking; the two
      // done plans are parked with all to-dos complete, so they resolve
      // terminal and land in review debt.
      backlogPlans: ["live-b.plan.md"],
      parkedPlans: ["done-old.plan.md", "done-new.plan.md"],
    };
    const items = buildExternalReportItems([liveA, doneNew, liveB, doneOld], plans, { handoff });
    expect(items.map((i) => ({ id: i.id, group: i.group }))).toEqual([
      // Blocking keeps incoming scan order (live-a before live-b).
      { id: "attention:report:live-a", group: "blocking" },
      { id: "attention:report:live-b", group: "blocking" },
      // Debt is oldest-first regardless of scan order.
      { id: "attention:report:done-old", group: "debt" },
      { id: "attention:report:done-new", group: "debt" },
    ]);
  });

  it("degrades to an empty list on missing or malformed input", () => {
    expect(buildExternalReportItems(undefined, [])).toEqual([]);
    expect(buildExternalReportItems([null, { slug: "no-file" }], [])).toEqual([]);
  });
});

describe("buildMissionControlView wiring", () => {
  it("surfaces untriaged reports in the attention stack and hides triaged ones", () => {
    const untriaged = report("plan-monitor-widget-rollout.md", "widget-rollout.plan.md");
    const triaged = report(
      "plan-monitor-readiness.md",
      "readiness.plan.md",
      "\n## Triage note - acknowledged\n",
    );
    const view = buildMissionControlView({
      plans: [],
      handoff: null,
      externalReports: [untriaged, triaged],
    });
    const surfaced = view.attention.filter((i) => i.kind === "report");
    expect(surfaced.length).toBe(1);
    expect(surfaced[0].id).toBe("attention:report:widget-rollout");
  });

  it("adds no report items when the memory directory yields nothing", () => {
    const view = buildMissionControlView({ plans: [], handoff: null, externalReports: [] });
    expect(view.attention.some((i) => i.kind === "report")).toBe(false);
  });

  it("mixes readiness notes into Field Report beside untriaged reviews", () => {
    const untriaged = report("plan-monitor-widget-rollout.md", "widget-rollout.plan.md");
    const view = buildMissionControlView({
      plans: [],
      handoff: null,
      externalReports: [untriaged],
      readinessPending: [
        { id: "confirm-provider", status: "needs_choice", essential: false, title: "Confirm" },
      ],
    });
    expect(view.attention.map((i) => i.kind).sort()).toEqual(["readiness", "report"]);
    expect(view.checklistNotes).toEqual([]);
    expect(view.attention.some((i) => i.kind === "readiness")).toBe(true);
  });
});

describe("fieldReportTriageAllAction", () => {
  it("returns null for an empty list", () => {
    expect(fieldReportTriageAllAction([])).toBeNull();
  });

  it("returns null for undefined/null input", () => {
    expect(fieldReportTriageAllAction(undefined as unknown as object[])).toBeNull();
    expect(fieldReportTriageAllAction(null as unknown as object[])).toBeNull();
  });

  it("builds a single-item review-all action from one gap report item", () => {
    const items = buildExternalReportItems(
      [
        report(
          "plan-monitor-widget.md",
          "widget.plan.md",
          "\n### Residual items for human attention\n\n1. Refresh the HANDOFF.\n",
        ),
      ],
      [],
    );
    expect(items[0]?.hasOpenReviewGaps).toBe(true);
    const action = fieldReportTriageAllAction(items);
    expect(action).toMatchObject({
      type: "copy",
      target: "/plan-review-triage .cursor/memory/plan-monitor-widget.md",
      label: "Copy review command for all",
      subject: "gap-aware review command for all",
      pasteDestination: "chatInput",
    });
  });

  it("omits clean Outcome-only reports from Review all", () => {
    const items = buildExternalReportItems([report("plan-monitor-clean.md", "clean.plan.md")], []);
    expect(items[0]?.hasOpenReviewGaps).toBe(false);
    expect(fieldReportTriageAllAction(items)).toBeNull();
  });

  it("builds a multi-item review-all action preserving blocking-then-debt order", () => {
    const live = report(
      "plan-monitor-live-work.md",
      "live-work.plan.md",
      "\n### Residual items for human attention\n\n1. Fix the live blocker.\n",
      "2026-07-25T10:00:00.000Z",
    );
    const doneOld = report(
      "plan-monitor-done-old.md",
      "done-old.plan.md",
      "\n### Still open (only these)\n\n| ID | What | Suggested action |\n|----|------|------------------|\n| A | Debt residual | triage |\n",
      "2026-07-01T10:00:00.000Z",
    );
    const plans = [
      {
        id: "live-work",
        file: "live-work.plan.md",
        path: ".cursor/plans/live-work.plan.md",
        overview: "",
        todos: {
          total: 2,
          completed: 1,
          pending: 1,
          inProgress: 0,
          items: [
            { id: "a", content: "A", status: "completed" },
            { id: "b", content: "B", status: "pending" },
          ],
        },
      },
      {
        id: "done-old",
        file: "done-old.plan.md",
        path: ".cursor/plans/done-old.plan.md",
        overview: "",
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
      },
    ];
    const handoff = {
      plan: "live-work.plan.md",
      mode: "continue-plan",
      parkedPlans: ["done-old.plan.md"],
    };
    const items = buildExternalReportItems([live, doneOld], plans, { handoff });
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("attention:report:live-work");
    expect(items[1].id).toBe("attention:report:done-old");
    const action = fieldReportTriageAllAction(items);
    expect(action?.target).toContain("plan-monitor-live-work.md");
    expect(action?.target).toContain("plan-monitor-done-old.md");
    // Blocking path comes first
    const paths = (action?.target || "").replace("/plan-review-triage ", "").split(" ");
    expect(paths[0]).toBe(".cursor/memory/plan-monitor-live-work.md");
    expect(paths[1]).toBe(".cursor/memory/plan-monitor-done-old.md");
  });

  it("returns null when no item has a sourcePath", () => {
    const items = [{ id: "attention:report:no-path", kind: "report" }];
    expect(fieldReportTriageAllAction(items as object[])).toBeNull();
  });
});

describe("reportHasOpenReviewGaps", () => {
  it("detects numbered residuals and empty Still open", () => {
    expect(
      reportHasOpenReviewGaps(
        "## Full review\n\n### Residual items for human attention\n\n1. Fix me.\n",
      ),
    ).toBe(true);
    expect(
      reportHasOpenReviewGaps("## Current state\n\n### Still open (only these)\n\nNone.\n"),
    ).toBe(false);
    expect(
      reportHasOpenReviewGaps("## Full review\n\nOutcome: all to-dos map to shipped work.\n"),
    ).toBe(false);
  });
});
