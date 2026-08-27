import { afterEach, describe, expect, it, vi } from "vitest";
import { HELMET_FILL, shouldUseWelcomeColor } from "../welcome/visual-kit.js";
import { renderMcTui, shouldLiveRefresh } from "./render.js";
import type { McTuiView } from "./view.js";

const view: McTuiView = {
  mission: {
    status: "executing",
    planFile: "demo.plan.md",
    mode: "run-plan",
    progressLabel: "1 of 4 complete",
    currentTodo: "phase1-data-adapter",
    nextTodo: "phase2-tui-renderer",
    gaps: null,
  },
  flightLog: { now: null, nowKind: "ok", earlier: [], warnings: [] },
  checklist: [
    {
      file: "demo.plan.md",
      lifecycle: "executing",
      progressLabel: "1 of 4 complete",
      currentTodo: "phase1-data-adapter",
    },
  ],
  crewMonitor: [{ kind: "run_plan", label: "crew · running · phase1-data-adapter" }],
  error: null,
};

function clearEnv(key: string): void {
  Reflect.deleteProperty(process.env, key);
}

describe("renderMcTui", () => {
  const prev = {
    NO_COLOR: process.env.NO_COLOR,
    CI: process.env.CI,
    FORCE_COLOR: process.env.FORCE_COLOR,
    NODE_DISABLE_COLORS: process.env.NODE_DISABLE_COLORS,
    AGENT_KIT_REDUCED_MOTION: process.env.AGENT_KIT_REDUCED_MOTION,
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) clearEnv(k);
      else process.env[k] = v;
    }
  });

  it("renders the four panel titles and glossary labels without ANSI when color is off", () => {
    const out = renderMcTui(view, { color: false, columns: 72 });
    expect(out).toContain("Mission");
    expect(out).toContain("Flight Log");
    expect(out).toContain("Checklist");
    expect(out).toContain("Crew Monitor");
    expect(out).toContain("demo.plan.md");
    expect(out.includes("\u001b")).toBe(false);
  });

  it("uses HELMET_FILL trueColor on titles when color is on", () => {
    vi.stubEnv("NO_COLOR", undefined);
    vi.stubEnv("CI", undefined);
    vi.stubEnv("FORCE_COLOR", undefined);
    vi.stubEnv("NODE_DISABLE_COLORS", undefined);
    expect(shouldUseWelcomeColor({ color: true, stdoutIsTTY: true })).toBe(true);
    const r = Number.parseInt(HELMET_FILL.slice(1, 3), 16);
    const g = Number.parseInt(HELMET_FILL.slice(3, 5), 16);
    const b = Number.parseInt(HELMET_FILL.slice(5, 7), 16);
    const out = renderMcTui(view, { color: true, stdoutIsTTY: true, columns: 72 });
    expect(out).toContain(`${r};${g};${b}`);
  });

  it("disables live refresh for --once, non-TTY, and CI", () => {
    expect(shouldLiveRefresh({ once: true, stdoutIsTTY: true, env: {} })).toBe(false);
    expect(shouldLiveRefresh({ stdoutIsTTY: false, env: {} })).toBe(false);
    expect(shouldLiveRefresh({ stdoutIsTTY: true, env: { CI: "1" } })).toBe(false);
    expect(shouldLiveRefresh({ stdoutIsTTY: true, env: {} })).toBe(true);
  });
});
