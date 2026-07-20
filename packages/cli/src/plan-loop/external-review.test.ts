import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  armExternalPlanReview,
  isPlanExhaustedReason,
  shouldArmExternalPlanReview,
} from "./external-review.js";

describe("isPlanExhaustedReason", () => {
  it("matches plan exhausted", () => {
    expect(isPlanExhaustedReason("plan exhausted")).toBe(true);
    expect(isPlanExhaustedReason("STOP - Plan Exhausted")).toBe(true);
  });

  it("matches all to-dos completed phrasing", () => {
    expect(isPlanExhaustedReason("all to-dos completed")).toBe(true);
    expect(isPlanExhaustedReason("all implementable todos done")).toBe(true);
  });

  it("rejects safety / HITL stops", () => {
    expect(isPlanExhaustedReason("external blocker")).toBe(false);
    expect(isPlanExhaustedReason("human gate")).toBe(false);
    expect(isPlanExhaustedReason("no progress")).toBe(false);
    expect(isPlanExhaustedReason("")).toBe(false);
  });
});

describe("shouldArmExternalPlanReview", () => {
  it("arms when pending is zero", () => {
    expect(shouldArmExternalPlanReview({ pending: 0 })).toBe(true);
  });

  it("arms on exhausted reason even if pending stale", () => {
    expect(shouldArmExternalPlanReview({ pending: 2, stopReason: "plan exhausted" })).toBe(true);
  });

  it("does not arm on blocker with pending work", () => {
    expect(shouldArmExternalPlanReview({ pending: 1, stopReason: "external blocker" })).toBe(false);
  });
});

describe("armExternalPlanReview", () => {
  it("tips and skips when script missing", async () => {
    const log = vi.fn();
    const result = await armExternalPlanReview("/repo", {
      existsFn: async () => false,
      log,
    });
    expect(result.invoked).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("missing"));
  });

  it("invokes script and ignores non-zero exit", async () => {
    const log = vi.fn();
    const spawnFn = vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
      const ee = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      ee.stdout = new EventEmitter();
      ee.stderr = new EventEmitter();
      queueMicrotask(() => {
        ee.stdout.emit("data", "tip: disabled\n");
        ee.emit("close", 0);
      });
      return ee as ReturnType<typeof import("node:child_process").spawn>;
    });

    const result = await armExternalPlanReview("/repo", {
      existsFn: async () => true,
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      log,
    });

    expect(result.invoked).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("tip: disabled");
    expect(spawnFn).toHaveBeenCalledWith(
      "bash",
      [expect.stringContaining("plan-external-review.sh")],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });
});
