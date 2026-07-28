import { describe, expect, it } from "vitest";
import { AGENT_PERSONA_MODE_DEFAULTS, agentPersonaConfigFromChoice } from "./prompts.js";

describe("agentPersonaConfigFromChoice", () => {
  it("returns null when the wizard skips personas", () => {
    expect(agentPersonaConfigFromChoice({ kind: "skip" })).toBeNull();
  });

  it("returns mode defaults without forcing a single persona", () => {
    expect(agentPersonaConfigFromChoice({ kind: "mode-defaults" })).toEqual({
      default: "autopilot",
      modes: {
        "continue-plan": "autopilot",
        "run-plan": "night-shift",
        "cli-run-plan": "ghost-runner",
      },
    });
    expect(AGENT_PERSONA_MODE_DEFAULTS.modes["run-plan"]).toBe("night-shift");
  });

  it("applies one selected persona across modes", () => {
    expect(agentPersonaConfigFromChoice({ kind: "persona", id: "ghost-runner" })).toEqual({
      default: "ghost-runner",
      modes: {
        "continue-plan": "ghost-runner",
        "run-plan": "ghost-runner",
        "cli-run-plan": "ghost-runner",
      },
    });
  });
});
