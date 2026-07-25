import { describe, expect, it } from "vitest";
import {
  MAX_EXTERNAL_REPORTS,
  MAX_SEMANTIC_LABEL,
  buildExternalReportItems,
  buildMissionControlView,
  isReportTriaged,
  parseExternalReport,
} from "../../../../dashboard/lib/semantic-model.mjs";

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

describe("buildExternalReportItems", () => {
  it("shapes an item that names the report, when it landed, and the triage command", () => {
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
      label: "External review of widget-rollout has no triage outcome yet",
      sourcePath: ".cursor/memory/plan-monitor-widget-rollout.md",
      modifiedAt: "2026-07-24T08:30:00.000Z",
      action: {
        type: "copy",
        target: "/plan-review-triage .cursor/memory/plan-monitor-widget-rollout.md",
        subject: "triage command",
        pasteDestination: "chat input",
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
});
