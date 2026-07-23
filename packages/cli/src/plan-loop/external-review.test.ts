import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  armExternalPlanReview,
  isPlanExhaustedReason,
  shouldArmExternalPlanReview,
} from "./external-review.js";

function mockSpawn(exitCode = 0, stdout = "ok\n") {
  return vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
    const ee = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();
    queueMicrotask(() => {
      ee.stdout.emit("data", stdout);
      ee.emit("close", exitCode);
    });
    return ee as ReturnType<typeof import("node:child_process").spawn>;
  });
}

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
  const canonicalRel = path.join(".cursor", "scripts", "plan-external-review.sh");
  const fallbackRel = path.join("scripts", "plan-external-review.sh");

  it("prefers .cursor/scripts when present", async () => {
    const log = vi.fn();
    const spawnFn = mockSpawn();
    const result = await armExternalPlanReview("/repo", {
      existsFn: async (p) => p.includes(path.join(".cursor", "scripts")),
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      log,
    });

    expect(result.invoked).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(
      "bash",
      [path.join("/repo", canonicalRel)],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("falls back to scripts/ when canonical missing", async () => {
    const log = vi.fn();
    const spawnFn = mockSpawn();
    const result = await armExternalPlanReview("/repo", {
      existsFn: async (p) => p === path.join("/repo", fallbackRel),
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      log,
    });

    expect(result.invoked).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(
      "bash",
      [path.join("/repo", fallbackRel)],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("tips and skips when both scripts missing", async () => {
    const log = vi.fn();
    const result = await armExternalPlanReview("/repo", {
      existsFn: async () => false,
      log,
    });
    expect(result.invoked).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(canonicalRel));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("missing"));
  });

  it("passes --force when force option is true", async () => {
    const log = vi.fn();
    const spawnFn = mockSpawn();
    const result = await armExternalPlanReview("/repo", {
      force: true,
      existsFn: async (p) => p.includes(path.join(".cursor", "scripts")),
      spawnFn: spawnFn as unknown as typeof import("node:child_process").spawn,
      log,
    });

    expect(result.invoked).toBe(true);
    expect(spawnFn).toHaveBeenCalledWith(
      "bash",
      [path.join("/repo", canonicalRel), "--force"],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("invokes script and ignores non-zero exit", async () => {
    const log = vi.fn();
    const spawnFn = mockSpawn(0, "tip: disabled\n");

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
