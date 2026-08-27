import { describe, expect, it } from "vitest";
import { buildMcTuiView } from "./view.js";

const snapshot = {
  missionControl: {
    now: {
      status: "executing",
      planFile: "demo.plan.md",
      mode: "run-plan-all",
      progress: { completed: 1, total: 4, label: "1 of 4 complete" },
      currentTodo: { id: "phase1-data-adapter" },
      nextTodo: { id: "phase2-tui-renderer" },
      gaps: null,
    },
    flightLog: {
      current: null,
      currentKind: "ok",
      past: [{ text: "earlier residual" }],
      warnings: [{ text: "API/usage limit; resume after named model" }],
    },
    plans: [
      {
        file: "demo.plan.md",
        lifecycle: "executing",
        progress: { label: "1 of 4 complete" },
        currentTodo: { id: "phase1-data-adapter" },
      },
      {
        file: "done.plan.md",
        lifecycle: "completed",
        progress: { label: "3 of 3 complete" },
      },
    ],
    activity: [
      { kind: "run_plan", label: "crew · running · phase1-data-adapter" },
      { kind: "handoff", label: "crew · awaiting · demo.plan.md" },
    ],
    monitorFeedCap: 20,
  },
};

describe("buildMcTuiView", () => {
  it("projects mission, flight log, open checklist, and crew monitor from snapshot builders", () => {
    const view = buildMcTuiView(snapshot);
    expect(view.error).toBeNull();
    expect(view.mission).toMatchObject({
      status: "executing",
      planFile: "demo.plan.md",
      currentTodo: "phase1-data-adapter",
    });
    expect(view.flightLog.now).toBeNull();
    expect(view.flightLog.earlier).toEqual(["earlier residual"]);
    expect(view.flightLog.warnings[0]).toContain("API/usage limit");
    expect(view.checklist.map((r) => r.file)).toEqual(["demo.plan.md"]);
    expect(view.crewMonitor).toHaveLength(2);
    expect(view.crewMonitor[0]?.kind).toBe("run_plan");
  });

  it("carries a collector error without inventing mission state", () => {
    const view = buildMcTuiView(null, "dashboard-data.mjs timed out after 60000ms");
    expect(view.error).toContain("timed out");
    expect(view.mission.status).toBe("idle");
    expect(view.checklist).toEqual([]);
    expect(view.crewMonitor).toEqual([]);
  });
});
