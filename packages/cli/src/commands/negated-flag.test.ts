import { type ArgsDef, parseArgs } from "citty";
import { describe, expect, it } from "vitest";
import { dashboardCommand } from "./dashboard.js";
import { dashboardBroadcastCommand } from "./dashboard-broadcast.js";
import { negatedFlag } from "./negated-flag.js";
import { runCommand, runPlanAllCommand } from "./run.js";
import { runPlanCommand } from "./run-plan.js";

const cases: Array<[string, unknown, string, string[]]> = [
  ["run", runCommand.args, "hitl", ["continue-plan"]],
  ["run-plan-all", runPlanAllCommand.args, "hitl", []],
  ["run-plan", runPlanCommand.args, "hitl", []],
  ["dashboard", dashboardCommand.args, "open", []],
  ["dashboard broadcast", dashboardBroadcastCommand.args, "open", []],
];

describe("negatedFlag", () => {
  for (const [label, argsDef, name, positional] of cases) {
    it(`${label}: --no-${name} reaches the command through citty`, () => {
      const def = argsDef as ArgsDef;
      expect(negatedFlag(parseArgs([...positional, `--no-${name}`], def), name)).toBe(true);
      expect(negatedFlag(parseArgs(positional, def), name)).toBe(false);
    });
  }

  it("still honours an explicit no-<name> key", () => {
    expect(negatedFlag({ "no-hitl": true }, "hitl")).toBe(true);
    expect(negatedFlag({ "no-hitl": false }, "hitl")).toBe(false);
  });
});
