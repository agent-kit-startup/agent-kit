import { describe, expect, it } from "vitest";
import { missionControlCommand } from "./mission-control.js";

describe("missionControlCommand", () => {
  it("registers the citty subcommand with --once", async () => {
    const meta = await (typeof missionControlCommand.meta === "function"
      ? missionControlCommand.meta()
      : missionControlCommand.meta);
    expect(meta?.name).toBe("mission-control");
    expect(meta?.description).toMatch(/without a browser/i);
    const args = await (typeof missionControlCommand.args === "function"
      ? missionControlCommand.args()
      : missionControlCommand.args);
    expect(args).toHaveProperty("once");
  });
});
