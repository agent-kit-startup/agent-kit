import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVITY,
  allowlistReadinessPending,
  buildAttentionItems,
  buildChecklistNotes,
  buildCurrentExecution,
  buildMissionControlView,
  classifyPlan,
  formatGitActivity,
  formatPlanHandoffActivity,
  mergeActivity,
  parseHandoffMarkdown,
  parseParkedPlans,
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
  });
});

describe("parseParkedPlans", () => {
  it("parses backtick and comma forms", () => {
    expect(parseParkedPlans("`a.plan.md` (note); `b.plan.md`")).toEqual(["a.plan.md", "b.plan.md"]);
    expect(parseParkedPlans("none")).toEqual([]);
  });
});

describe("classifyPlan", () => {
  const executingHandoff = {
    plan: "mission-control-plugin-ux.plan.md",
    mode: "run-plan (orchestrated)",
    parkedPlans: ["mission-control-hardening.plan.md"],
    nextTodos: "`semantic-snapshot-model`",
  };

  it("classifies executing, parked, completed, and incomplete", () => {
    expect(classifyPlan(samplePlans[0], executingHandoff)).toBe("executing");
    expect(classifyPlan(samplePlans[1], executingHandoff)).toBe("parked");
    expect(
      classifyPlan(samplePlans[1], {
        plan: "mission-control-plugin-ux.plan.md",
        parkedPlans: [],
      }),
    ).toBe("completed");
    expect(classifyPlan(samplePlans[2], executingHandoff)).toBe("incomplete");
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
  });

  it("returns idle when HANDOFF has no plan", () => {
    const idle = buildCurrentExecution(samplePlans, null);
    expect(idle.status).toBe("idle");
    expect(idle.previousTodo).toBeNull();
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
    expect(planEvents[0].label).toContain("semantic-snapshot-model");

    const merged = mergeActivity([
      planEvents,
      formatGitActivity(Array.from({ length: 30 }, (_, i) => `aaaaaa${i} commit ${i}`)),
    ]);
    expect(merged.length).toBeLessThanOrEqual(MAX_ACTIVITY);
    expect(new Set(merged.map((e) => e.id)).size).toBe(merged.length);
  });
});

const awaitingHandoff = {
  plan: "mission-control-plugin-ux.plan.md",
  mode: "awaiting Gate B",
  parkedPlans: ["mission-control-hardening.plan.md"],
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

const awaitingPlans = [awaitingPlan, samplePlans[1], samplePlans[2]];

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

describe("buildAttentionItems", () => {
  it("keeps the awaiting handoff gate in Field Report", () => {
    const now = buildCurrentExecution(awaitingPlans, awaitingHandoff);
    const items = buildAttentionItems({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      now,
    });

    expect(items.some((i) => i.id === "attention:handoff-awaiting")).toBe(true);
    expectHonestActions(items);
  });

  it("no longer carries plan-status or readiness items", () => {
    const now = buildCurrentExecution(awaitingPlans, awaitingHandoff);
    const items = buildAttentionItems({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      now,
    });

    expect(items.some((i) => i.kind === "parked")).toBe(false);
    expect(items.some((i) => i.kind === "incomplete")).toBe(false);
    expect(items.some((i) => i.kind === "readiness")).toBe(false);
    expect(items.every((i) => ["prompt", "report", "handoff"].includes(i.kind))).toBe(true);
  });
});

describe("buildChecklistNotes", () => {
  it("carries parked, incomplete, and advisory readiness with plan progress", () => {
    const notes = buildChecklistNotes({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      readinessPending: readinessAdvisory,
    });

    expect(notes.some((i) => i.id.includes("parked"))).toBe(true);
    expect(notes.some((i) => i.id.includes("incomplete"))).toBe(true);
    expect(notes.some((i) => i.id.includes("confirm-provider"))).toBe(true);
    const parked = notes.find((i) => i.kind === "parked");
    const incomplete = notes.find((i) => i.kind === "incomplete");
    expect(parked?.progress?.label).toMatch(/\d+ of \d+/);
    expect(incomplete?.progress?.label).toMatch(/\d+ of \d+/);
    expectHonestActions(notes);
  });

  it("names the plan file once per plan so the panel can reconcile duplicates", () => {
    const notes = buildChecklistNotes({
      plans: awaitingPlans,
      handoff: awaitingHandoff,
      readinessPending: readinessAdvisory,
    });

    const planNotes = notes.filter((i) => i.kind === "parked" || i.kind === "incomplete");
    expect(planNotes.length).toBeGreaterThan(0);
    expect(planNotes.map((i) => i.planFile)).toEqual([
      "mission-control-hardening.plan.md",
      "other-incomplete.plan.md",
    ]);
    expect(new Set(notes.map((i) => i.id)).size).toBe(notes.length);
    expect(notes.some((i) => i.kind === "readiness" && i.planFile)).toBe(false);
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
});

describe("allowlistReadinessPending", () => {
  it("keeps only safe fields", () => {
    const out = allowlistReadinessPending([
      {
        id: "confirm-provider",
        status: "needs_choice",
        essential: false,
        title: "Confirm",
        secretDump: { remote: "should-not-leak" },
      },
    ]);
    expect(out[0]).toEqual({
      id: "confirm-provider",
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
- **Parked plans:** \`mission-control-hardening.plan.md\`
`);
    const view = buildMissionControlView({
      plans: samplePlans,
      handoff,
      gitLogLines: ["34d3880 Merge pull request #200 from agent-kit-startup/docs/x"],
      readinessPending: [{ id: "confirm-provider", status: "needs_choice", essential: false }],
    });

    expect(view.schemaVersion).toBe("1.0.0");
    expect(view.now.status).toBe("executing");
    expect(view.now.currentTodo?.id).toBe("semantic-snapshot-model");
    expect(view.activity.some((e) => e.kind === "merge")).toBe(true);
    expect(view.plans.find((p) => p.file.includes("hardening"))?.lifecycle).toBe("parked");
    // Plan state and readiness moved to Checklist; an executing plan with no
    // prompt or report leaves Field Report clear.
    expect(view.attention).toEqual([]);
    expect(view.checklistNotes.map((i) => i.kind)).toContain("parked");
    expect(view.checklistNotes.map((i) => i.kind)).toContain("incomplete");
    expect(view.checklistNotes.map((i) => i.kind)).toContain("readiness");
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
});
