import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHandoffMarkdown } from "../../../../dashboard/lib/semantic-model.mjs";
import {
  canDispatchQueuedPlan,
  classifyOrchestratorAction,
  decideCursorAdvance,
  isForbiddenOrchestratorAction,
  isQueueConfirmGranted,
  isValidPlanWorkerSummary,
  parsePlanWorkerSummary,
  serializeRunPlanAllQueueFields,
} from "./run-plan-all-orchestrator.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("confirm Ask blocks execute-queue", () => {
  it("refuses dispatch until confirmGranted", () => {
    expect(isQueueConfirmGranted({ confirmGranted: false })).toBe(false);
    expect(canDispatchQueuedPlan({ confirmGranted: false })).toBe(false);
  });

  it("allows dispatch only after confirm Ask is granted", () => {
    expect(isQueueConfirmGranted({ confirmGranted: true })).toBe(true);
    expect(canDispatchQueuedPlan({ confirmGranted: true })).toBe(true);
  });
});

describe("malformed Task summary does not advance cursor", () => {
  const queue = ["a.plan.md", "b.plan.md", "c.plan.md"];

  it("accepts a valid structured summary and advances", () => {
    const decision = decideCursorAdvance({
      queue,
      cursor: 0,
      summary: {
        outcome: "completed",
        lastTodoId: "validate",
        filesTouched: ["packages/cli/src/x.ts"],
      },
    });
    expect(decision.advance).toBe(true);
    expect(decision.nextCursor).toBe(1);
    expect(decision.outcome).toBe("completed");
    expect(decision.reason).toBe("valid_summary");
  });

  it("parses JSON text summaries", () => {
    const parsed = parsePlanWorkerSummary(
      'Worker done.\n```json\n{"outcome":"partial","lastTodoId":"t1","filesTouched":[]}\n```',
    );
    expect(parsed).toEqual({
      outcome: "partial",
      lastTodoId: "t1",
      filesTouched: [],
    });
    expect(isValidPlanWorkerSummary(parsed)).toBe(true);
  });

  it("rejects missing summary without inventing an outcome", () => {
    const decision = decideCursorAdvance({ queue, cursor: 1, summary: null });
    expect(decision.advance).toBe(false);
    expect(decision.reason).toBe("malformed_summary_requires_ask");
    expect(decision.outcome).toBeUndefined();
    expect(decision.nextCursor).toBeUndefined();
  });

  it("rejects invalid outcome / missing lastTodoId / non-array filesTouched", () => {
    expect(parsePlanWorkerSummary({ outcome: "done", lastTodoId: "x", filesTouched: [] })).toBe(
      null,
    );
    expect(parsePlanWorkerSummary({ outcome: "completed", lastTodoId: "", filesTouched: [] })).toBe(
      null,
    );
    expect(
      parsePlanWorkerSummary({
        outcome: "blocked",
        lastTodoId: "x",
        filesTouched: "oops",
      }),
    ).toBe(null);
    expect(isValidPlanWorkerSummary({ outcome: "completed" })).toBe(false);

    const decision = decideCursorAdvance({
      queue,
      cursor: 0,
      summary: { outcome: "completed", lastTodoId: "x" },
    });
    expect(decision.advance).toBe(false);
    expect(decision.reason).toBe("malformed_summary_requires_ask");
  });

  it("advances on malformed only when userAuthorizedAdvanceOnMalformed", () => {
    const blocked = decideCursorAdvance({
      queue,
      cursor: 0,
      summary: "not json",
    });
    expect(blocked.advance).toBe(false);

    const authorized = decideCursorAdvance({
      queue,
      cursor: 0,
      summary: "not json",
      userAuthorizedAdvanceOnMalformed: true,
    });
    expect(authorized.advance).toBe(true);
    expect(authorized.nextCursor).toBe(1);
    expect(authorized.outcome).toBeUndefined();
    expect(authorized.reason).toBe("user_authorized_malformed");
  });
});

describe("HANDOFF queue fields round-trip", () => {
  it("serializes Mode / Run queue / cursor / status / outcomes for parseHandoffMarkdown", () => {
    const md = serializeRunPlanAllQueueFields({
      plan: "cockpit-run-plan-all-queue.plan.md",
      lastUpdated: "2026-07-26 13:49",
      mode: "run-plan-all",
      runQueue: [
        "checklist-plans-active-progress-shimmer.plan.md",
        "monitor-feed-single-roll-residuals.plan.md",
        "cockpit-run-plan-all-queue.plan.md",
      ],
      queueCursor: 2,
      queueCursorPlan: "cockpit-run-plan-all-queue.plan.md",
      queueStatus: "running",
      queueOutcomes: {
        "checklist-plans-active-progress-shimmer.plan.md": "completed",
        "monitor-feed-single-roll-residuals.plan.md": "completed",
      },
    });

    const handoff = parseHandoffMarkdown(md);
    expect(handoff).not.toBeNull();
    if (!handoff) throw new Error("expected parseHandoffMarkdown to return a handoff");
    expect(handoff.mode).toBe("run-plan-all");
    expect(handoff.runQueue).toEqual([
      "checklist-plans-active-progress-shimmer.plan.md",
      "monitor-feed-single-roll-residuals.plan.md",
      "cockpit-run-plan-all-queue.plan.md",
    ]);
    expect(handoff.queueCursor).toBe(2);
    expect(handoff.queueCursorPlan).toBe("cockpit-run-plan-all-queue.plan.md");
    expect(handoff.queueStatus).toBe("running");
    expect(handoff.queueOutcomes).toEqual({
      "checklist-plans-active-progress-shimmer.plan.md": "completed",
      "monitor-feed-single-roll-residuals.plan.md": "completed",
    });
  });
});

describe("in-window implement guard (transcript 606a14a5)", () => {
  it("forbids product edits, tests, CHANGELOG, plan edits, and in-window /run-plan implement", () => {
    expect(isForbiddenOrchestratorAction({ kind: "product_edit", path: "src/app.ts" })).toBe(true);
    expect(isForbiddenOrchestratorAction({ kind: "run_tests" })).toBe(true);
    expect(isForbiddenOrchestratorAction({ kind: "write_changelog", path: "CHANGELOG.md" })).toBe(
      true,
    );
    expect(
      isForbiddenOrchestratorAction({
        kind: "edit_plan_file",
        path: ".cursor/plans/foo.plan.md",
      }),
    ).toBe(true);
    expect(isForbiddenOrchestratorAction({ kind: "in_window_run_plan_implement" })).toBe(true);
    expect(classifyOrchestratorAction({ kind: "product_edit" })).toBe("forbidden");
  });

  it("allows Ask, Task dispatch, HANDOFF queue writes, and approved consolidation", () => {
    expect(classifyOrchestratorAction({ kind: "ask" })).toBe("allowed");
    expect(classifyOrchestratorAction({ kind: "task_dispatch" })).toBe("allowed");
    expect(classifyOrchestratorAction({ kind: "handoff_queue_write" })).toBe("allowed");
    expect(classifyOrchestratorAction({ kind: "approved_consolidation" })).toBe("allowed");
    expect(isForbiddenOrchestratorAction({ kind: "task_dispatch" })).toBe(false);
  });
});

describe("run-plan-all.md orchestrator prose contract", () => {
  it("keeps confirm-before-execute, malformed Ask, pure orchestrator, and Task-per-plan invariants", async () => {
    const command = await readFile(
      path.join(REPOSITORY_ROOT, ".cursor/commands/run-plan-all.md"),
      "utf8",
    );

    expect(command).toMatch(/pure orchestrator/i);
    expect(command).toMatch(/dispatches one Task subagent per queued plan/i);
    expect(command).toMatch(/must not.*implement to-dos/i);
    expect(command).toMatch(/Missing or malformed summary/i);
    expect(command).toMatch(/Ask the user.*before advancing the cursor/i);
    expect(command).toMatch(/Do not invent an outcome/i);
    expect(command).toMatch(/confirm Ask/i);
    expect(command).toContain("Mandatory execution Task is **per queued plan** after confirmation");
  });
});
