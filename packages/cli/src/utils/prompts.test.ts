import { describe, expect, it } from "vitest";
import { WORKSPACE_SKIN_MODE_DEFAULTS, workspaceSkinConfigFromChoice } from "./prompts.js";

describe("workspaceSkinConfigFromChoice", () => {
  it("returns null when the wizard skips skins", () => {
    expect(workspaceSkinConfigFromChoice({ kind: "skip" })).toBeNull();
  });

  it("returns mode defaults without forcing a single skin", () => {
    expect(workspaceSkinConfigFromChoice({ kind: "mode-defaults" })).toEqual({
      default: "autopilot",
      modes: {
        "continue-plan": "autopilot",
        "run-plan": "night-shift",
        "cli-run-plan": "ghost-runner",
      },
    });
    expect(WORKSPACE_SKIN_MODE_DEFAULTS.modes["run-plan"]).toBe("night-shift");
  });

  it("applies one selected skin across modes", () => {
    expect(workspaceSkinConfigFromChoice({ kind: "skin", id: "ghost-runner" })).toEqual({
      default: "ghost-runner",
      modes: {
        "continue-plan": "ghost-runner",
        "run-plan": "ghost-runner",
        "cli-run-plan": "ghost-runner",
      },
    });
  });
});
