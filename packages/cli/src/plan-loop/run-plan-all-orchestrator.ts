/**
 * Pure decision helpers for the `/run-plan-all` orchestrator contract.
 * Used by regression tests (and future CLI) so dogfood failure modes stay locked.
 * See `.cursor/memory/decisions/2026-07-26_run-plan-all-pure-orchestration.md`
 * and `.cursor/memory/decisions/2026-09-25_run-plan-all-three-hitl-points.md`.
 */

export const PLAN_WORKER_OUTCOMES = ["completed", "blocked", "partial"] as const;
export type PlanWorkerOutcome = (typeof PLAN_WORKER_OUTCOMES)[number];

/** Start-vs-resume Ask when a Backlog plan appeared after the last queue confirm. */
export const QUEUE_DRIFT_ASK_LABELS = [
  "Resume frozen queue",
  "Insert new backlog",
  "Re-synthesize",
] as const;

/** Plan-boundary context checkpoint (~50% orchestrator window self-estimate). */
export const CONTEXT_CHECKPOINT_ASK_LABELS = [
  "Continue queue",
  "Stop and prepare handoff",
  "Change queue",
] as const;

/**
 * Novel error / expired wait Ask. Same three labels as the ship-lane intake
 * runbook; do not invent a fourth.
 */
export { NOVEL_SHIP_FAILURE_ASK_LABELS as NOVEL_FAILURE_ASK_LABELS } from "./run-plan-all-intake-runbook.js";

/** Fraction of orchestrator window that triggers the context checkpoint Ask. */
export const CONTEXT_CHECKPOINT_WINDOW_THRESHOLD = 0.5;

export type PlanWorkerSummary = {
  outcome: PlanWorkerOutcome;
  lastTodoId: string;
  filesTouched: string[];
  failures?: string[];
};

export type QueueConfirmState = {
  /** True only after the operator answers the queue confirm Ask. */
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
  | "ship_lane"
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
  /**
   * Gate-A Backlog basenames visible at the last queue confirm.
   * Drift Ask compares current Backlog to this set (not to Run queue alone).
   */
  confirmedBacklog?: string[];
  lastUpdated?: string;
};

export type QueueDriftInput = {
  /** Backlog basenames recorded at the last queue confirm (`- **Confirmed backlog:**`). */
  confirmedBacklog: readonly string[];
  /** Gate-A Backlog basenames now. */
  currentBacklog: readonly string[];
  /** True when a stored Run queue item is missing or status-invalidated. */
  queuedPlanInvalid?: boolean;
};

export type QueueDriftDecision = {
  ask: boolean;
  reason: "no_drift" | "backlog_appeared_since_confirm" | "queued_plan_invalid";
  /** Basenames in current Backlog that were not in the confirmed set. */
  newBacklog: string[];
  labels: typeof QUEUE_DRIFT_ASK_LABELS;
};

export type ContextCheckpointInput = {
  /** True only at a plan boundary (after ship lane / before the next plan Task). */
  atPlanBoundary: boolean;
  /** Orchestrator self-estimate of window use in [0, 1]. Claude has no preCompact. */
  estimatedWindowUse: number;
  /** Override threshold; default CONTEXT_CHECKPOINT_WINDOW_THRESHOLD (0.5). */
  threshold?: number;
};

export type ContextCheckpointDecision = {
  ask: boolean;
  reason: "not_at_boundary" | "below_threshold" | "checkpoint";
  labels: typeof CONTEXT_CHECKPOINT_ASK_LABELS;
};

const OUTCOME_SET = new Set<string>(PLAN_WORKER_OUTCOMES);

export function isQueueConfirmGranted(state: QueueConfirmState): boolean {
  return state.confirmGranted === true;
}

/**
 * Execute-queue dispatch is blocked until the queue confirm Ask is answered.
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

/** What stopped a plan worker. Only `operator_gate` defers; the rest still stop. */
export type BlockerClass = "operator_gate" | "dependency" | "other";

export type BlockedPlanDispositionInput = {
  queue: string[];
  cursor: number;
  /** Worker summary for `queue[cursor]`. Not required when resuming a stored block. */
  summary?: unknown;
  blockerClass: BlockerClass;
  /** Operator gate label (e.g. "GitHub Sponsors checkout"). Falls back to summary failures. */
  gate?: string;
  /** PO dependency map: plan basename → basenames it blocks (`A blocks B`). */
  dependencyMap?: Readonly<Record<string, readonly string[]>>;
  /** Plans already deferred in this run: basename → gate. */
  deferred?: Readonly<Record<string, string>>;
  /** HANDOFF `Queue status` as stored (resume path). */
  storedQueueStatus?: string;
};

export type BlockedPlanDispositionAction = "advance" | "defer_advance" | "defer_dependent" | "stop";

export type BlockedPlanDisposition = {
  action: BlockedPlanDispositionAction;
  reason:
    | "empty_queue"
    | "cursor_out_of_range"
    | "malformed_summary_requires_ask"
    | "completed"
    | "operator_gate_deferred"
    | "resume_converts_operator_gate"
    | "dependent_of_deferred_plan"
    | "true_dependency"
    | "non_operator_blocker";
  plan?: string;
  /** Queue outcome token for `plan` (e.g. `deferred-operator (gate: ...)`). */
  outcome?: string;
  nextCursor?: number;
  /** Queue status to write back: `running`, `blocked`, or the queue-end status. */
  queueStatus: string;
  /** Deferred plans after this decision: basename → gate. */
  deferred: Record<string, string>;
  /** Open gates, one line per deferred plan; non-empty only at queue end. */
  gates: string[];
};

export function formatDeferredOperatorOutcome(gate: string): string {
  return `deferred-operator (gate: ${gate})`;
}

/**
 * Queue-end status. `exhausted` stays the first word so readers that only look at
 * it (Mission Control `firstWord`) still see a finished queue.
 */
export function formatQueueEndStatus(deferred: Readonly<Record<string, string>>): string {
  const entries = Object.entries(deferred);
  if (entries.length === 0) return "exhausted";
  return `exhausted (deferred: ${entries.map(([plan, gate]) => `${plan} -> ${gate}`).join("; ")})`;
}

function blockingDeferredPlan(
  plan: string,
  deferred: Readonly<Record<string, string>>,
  dependencyMap: Readonly<Record<string, readonly string[]>>,
): string | undefined {
  return Object.keys(deferred).find((blocker) => dependencyMap[blocker]?.includes(plan));
}

/**
 * Decide what the queue does with the plan at `cursor` when its worker stops
 * (ADR 2026-09-28_run-plan-all-defer-operator-gates). An operator-only gate
 * defers the plan and advances; a dependent of a deferred plan defers with
 * gate = the blocking plan; a true dependency or any other blocker stops.
 * Never performs or skips the operator step itself.
 */
export function decideBlockedPlanDisposition(
  input: BlockedPlanDispositionInput,
): BlockedPlanDisposition {
  const { queue, cursor } = input;
  const deferred: Record<string, string> = { ...(input.deferred ?? {}) };
  const stop = (
    reason: BlockedPlanDisposition["reason"],
    plan?: string,
  ): BlockedPlanDisposition => ({
    action: "stop",
    reason,
    ...(plan ? { plan } : {}),
    queueStatus: "blocked",
    deferred,
    gates: [],
  });

  if (!Array.isArray(queue) || queue.length === 0) return stop("empty_queue");
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= queue.length) {
    return stop("cursor_out_of_range");
  }
  const plan = queue[cursor] as string;

  const advanceWith = (
    action: BlockedPlanDispositionAction,
    reason: BlockedPlanDisposition["reason"],
    outcome: string,
  ): BlockedPlanDisposition => {
    const nextCursor = cursor + 1;
    const queueEnd = nextCursor >= queue.length;
    return {
      action,
      reason,
      plan,
      outcome,
      nextCursor,
      queueStatus: queueEnd ? formatQueueEndStatus(deferred) : "running",
      deferred,
      gates: queueEnd ? Object.entries(deferred).map(([p, gate]) => `${p}: ${gate}`) : [],
    };
  };

  const blocker = blockingDeferredPlan(plan, deferred, input.dependencyMap ?? {});
  if (blocker) {
    deferred[plan] = blocker;
    return advanceWith(
      "defer_dependent",
      "dependent_of_deferred_plan",
      formatDeferredOperatorOutcome(blocker),
    );
  }

  const resuming = input.storedQueueStatus?.trim().split(/\s+/)[0] === "blocked";
  const summary = parsePlanWorkerSummary(input.summary);
  if (!summary && !resuming) return stop("malformed_summary_requires_ask", plan);
  if (summary?.outcome === "completed") return advanceWith("advance", "completed", "completed");

  if (input.blockerClass === "dependency") return stop("true_dependency", plan);
  if (input.blockerClass !== "operator_gate") return stop("non_operator_blocker", plan);

  const gate = input.gate?.trim() || summary?.failures?.[0]?.trim() || "operator gate";
  deferred[plan] = gate;
  return advanceWith(
    "defer_advance",
    summary ? "operator_gate_deferred" : "resume_converts_operator_gate",
    formatDeferredOperatorOutcome(gate),
  );
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
  "ship_lane",
]);

/**
 * Classify whether an orchestrator action is allowed after queue confirm.
 * Transcript 606a14a5 failure mode: in-window product/test/CHANGELOG/plan
 * implementation instead of Task dispatch + HANDOFF writes.
 * `ship_lane` is the per-plan promote only. It is not plan implementation.
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

function normalizeBasenames(list: readonly string[] | null | undefined): string[] {
  if (!list?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Backlog basenames that appeared after the last queue confirm.
 * A stable Backlog that was already present at confirm is not drift.
 */
export function backlogAppearedSinceConfirm(
  confirmedBacklog: readonly string[],
  currentBacklog: readonly string[],
): string[] {
  const confirmed = new Set(normalizeBasenames(confirmedBacklog));
  return normalizeBasenames(currentBacklog).filter((name) => !confirmed.has(name));
}

/**
 * Drift Ask fires only when a Backlog plan appeared after the last queue confirm,
 * or when a stored queue item is missing / status-invalidated.
 * Eligible-not-queued Backlog that was already in the confirmed set is not drift.
 */
export function decideQueueDriftAsk(input: QueueDriftInput): QueueDriftDecision {
  const newBacklog = backlogAppearedSinceConfirm(input.confirmedBacklog, input.currentBacklog);
  if (input.queuedPlanInvalid === true) {
    return {
      ask: true,
      reason: "queued_plan_invalid",
      newBacklog,
      labels: QUEUE_DRIFT_ASK_LABELS,
    };
  }
  if (newBacklog.length > 0) {
    return {
      ask: true,
      reason: "backlog_appeared_since_confirm",
      newBacklog,
      labels: QUEUE_DRIFT_ASK_LABELS,
    };
  }
  return {
    ask: false,
    reason: "no_drift",
    newBacklog: [],
    labels: QUEUE_DRIFT_ASK_LABELS,
  };
}

/**
 * Context checkpoint at plan boundaries when the orchestrator estimates about
 * 50% or more window use. Claude Code has no preCompact signal: self-estimate.
 */
export function decideContextCheckpointAsk(
  input: ContextCheckpointInput,
): ContextCheckpointDecision {
  const labels = CONTEXT_CHECKPOINT_ASK_LABELS;
  if (!input.atPlanBoundary) {
    return { ask: false, reason: "not_at_boundary", labels };
  }
  const threshold = input.threshold ?? CONTEXT_CHECKPOINT_WINDOW_THRESHOLD;
  const use = Number.isFinite(input.estimatedWindowUse) ? input.estimatedWindowUse : 0;
  if (use < threshold) {
    return { ask: false, reason: "below_threshold", labels };
  }
  return { ask: true, reason: "checkpoint", labels };
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
  );

  const confirmed = normalizeBasenames(slice.confirmedBacklog);
  if (confirmed.length > 0) {
    lines.push(`- **Confirmed backlog:** [${confirmed.join(", ")}]`);
  }

  lines.push("- **Queue outcomes:**");

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
