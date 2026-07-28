/**
 * Pure decision helpers for the `/run-plan-all` orchestrator contract.
 * Used by regression tests (and future CLI) so dogfood failure modes stay locked.
 * See `.cursor/memory/decisions/2026-07-26_run-plan-all-pure-orchestration.md`.
 */

export const PLAN_WORKER_OUTCOMES = ["completed", "blocked", "partial"] as const;
export type PlanWorkerOutcome = (typeof PLAN_WORKER_OUTCOMES)[number];

export type PlanWorkerSummary = {
  outcome: PlanWorkerOutcome;
  lastTodoId: string;
  filesTouched: string[];
  failures?: string[];
};

export type QueueConfirmState = {
  /** True only after the operator answers the 6-way confirm Ask. */
  confirmGranted: boolean;
};

export type CursorAdvanceInput = {
  queue: string[];
  cursor: number;
  summary: unknown;
  /** Operator explicitly authorized advance after a malformed-summary Ask. */
  userAuthorizedAdvanceOnMalformed?: boolean;
};

export type CursorAdvanceDecision = {
  advance: boolean;
  reason: string;
  nextCursor?: number;
  outcome?: PlanWorkerOutcome;
};

export type OrchestratorActionKind =
  | "ask"
  | "task_dispatch"
  | "handoff_queue_write"
  | "approved_consolidation"
  | "product_edit"
  | "run_tests"
  | "write_changelog"
  | "edit_plan_file"
  | "in_window_run_plan_implement";

export type OrchestratorAction = {
  kind: OrchestratorActionKind;
  /** Path touched, when relevant (product/plan/CHANGELOG). */
  path?: string;
};

export type RunPlanAllQueueSlice = {
  mode?: string;
  plan?: string;
  runQueue: string[];
  queueCursor: number;
  queueCursorPlan?: string | null;
  queueStatus: string;
  /** Basename → outcome token (optional notes ignored by Mission Control parse). */
  queueOutcomes: Record<string, string>;
  lastUpdated?: string;
};

const OUTCOME_SET = new Set<string>(PLAN_WORKER_OUTCOMES);

export function isQueueConfirmGranted(state: QueueConfirmState): boolean {
  return state.confirmGranted === true;
}

/**
 * Execute-queue dispatch is blocked until the 6-way confirm Ask is answered.
 * PO synthesis Task(explore) is out of scope here; this gates plan Tasks only.
 */
export function canDispatchQueuedPlan(state: QueueConfirmState): boolean {
  return isQueueConfirmGranted(state);
}

export function isValidPlanWorkerSummary(value: unknown): value is PlanWorkerSummary {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.outcome !== "string" || !OUTCOME_SET.has(obj.outcome)) return false;
  if (typeof obj.lastTodoId !== "string" || obj.lastTodoId.trim() === "") return false;
  if (!Array.isArray(obj.filesTouched)) return false;
  if (!obj.filesTouched.every((f) => typeof f === "string")) return false;
  if (obj.failures !== undefined) {
    if (!Array.isArray(obj.failures) || !obj.failures.every((f) => typeof f === "string")) {
      return false;
    }
  }
  return true;
}

/**
 * Parse a worker summary from a plain object or JSON / fenced JSON text.
 * Returns null when missing or malformed (caller must Ask; never invent).
 */
export function parsePlanWorkerSummary(input: unknown): PlanWorkerSummary | null {
  if (input == null) return null;

  let candidate: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced?.[1]?.trim() ?? trimmed;
    try {
      candidate = JSON.parse(jsonText);
    } catch {
      // Try to extract a single JSON object from surrounding prose.
      const start = jsonText.indexOf("{");
      const end = jsonText.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      try {
        candidate = JSON.parse(jsonText.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  if (!isValidPlanWorkerSummary(candidate)) return null;
  return {
    outcome: candidate.outcome,
    lastTodoId: candidate.lastTodoId.trim(),
    filesTouched: [...candidate.filesTouched],
    ...(candidate.failures ? { failures: [...candidate.failures] } : {}),
  };
}

/**
 * Advance `Queue cursor` only on a valid summary (or explicit user authorization
 * after a malformed-summary Ask). Does not invent an outcome.
 */
export function decideCursorAdvance(input: CursorAdvanceInput): CursorAdvanceDecision {
  const { queue, cursor } = input;
  if (!Array.isArray(queue) || queue.length === 0) {
    return { advance: false, reason: "empty_queue" };
  }
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= queue.length) {
    return { advance: false, reason: "cursor_out_of_range" };
  }

  const summary = parsePlanWorkerSummary(input.summary);
  if (summary) {
    const nextCursor = cursor + 1;
    if (nextCursor >= queue.length) {
      return {
        advance: true,
        reason: "valid_summary_queue_exhausted",
        nextCursor,
        outcome: summary.outcome,
      };
    }
    return {
      advance: true,
      reason: "valid_summary",
      nextCursor,
      outcome: summary.outcome,
    };
  }

  if (input.userAuthorizedAdvanceOnMalformed === true) {
    const nextCursor = cursor + 1;
    return {
      advance: true,
      reason: "user_authorized_malformed",
      nextCursor,
    };
  }

  return { advance: false, reason: "malformed_summary_requires_ask" };
}

const FORBIDDEN_KINDS = new Set<OrchestratorActionKind>([
  "product_edit",
  "run_tests",
  "write_changelog",
  "edit_plan_file",
  "in_window_run_plan_implement",
]);

const ALLOWED_KINDS = new Set<OrchestratorActionKind>([
  "ask",
  "task_dispatch",
  "handoff_queue_write",
  "approved_consolidation",
]);

/**
 * Classify whether an orchestrator action is allowed after queue confirm.
 * Transcript 606a14a5 failure mode: in-window product/test/CHANGELOG/plan
 * implementation instead of Task dispatch + HANDOFF writes.
 */
export function classifyOrchestratorAction(
  action: OrchestratorAction,
): "allowed" | "forbidden" | "unknown" {
  if (FORBIDDEN_KINDS.has(action.kind)) return "forbidden";
  if (ALLOWED_KINDS.has(action.kind)) return "allowed";
  return "unknown";
}

export function isForbiddenOrchestratorAction(action: OrchestratorAction): boolean {
  return classifyOrchestratorAction(action) === "forbidden";
}

/**
 * Emit HANDOFF machine-field bullets for the `/run-plan-all` queue slice.
 * Round-trips through `parseHandoffMarkdown` (dashboard semantic-model).
 */
export function serializeRunPlanAllQueueFields(slice: RunPlanAllQueueSlice): string {
  const plan = slice.plan ?? slice.queueCursorPlan ?? slice.runQueue[slice.queueCursor] ?? "none";
  const current =
    slice.queueCursorPlan ??
    (Number.isInteger(slice.queueCursor) ? slice.runQueue[slice.queueCursor] : undefined);
  const cursorLine =
    current != null ? `${slice.queueCursor} (current: ${current})` : String(slice.queueCursor);

  const lines: string[] = ["# Handoff - run-plan-all queue", "", `- **Plan:** \`${plan}\``];
  if (slice.lastUpdated) {
    lines.push(`- **Last updated:** ${slice.lastUpdated}`);
  }
  lines.push(
    `- **Mode:** ${slice.mode ?? "run-plan-all"}`,
    `- **Run queue:** [${slice.runQueue.join(", ")}]`,
    `- **Queue cursor:** ${cursorLine}`,
    `- **Queue status:** ${slice.queueStatus}`,
    "- **Queue outcomes:**",
  );

  const outcomeEntries = Object.entries(slice.queueOutcomes);
  if (outcomeEntries.length === 0) {
    lines.push("  - none");
  } else {
    for (const [basename, outcome] of outcomeEntries) {
      lines.push(`  - ${basename}: ${outcome}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
