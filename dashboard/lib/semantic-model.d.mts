/**
 * Type shim for `semantic-model.mjs` (JS runtime remains SoT).
 * NodeNext resolves `*.mjs` imports to a sibling `*.d.mts` declaration.
 * Unblocks packages/cli `tsc --noEmit` (orchestrator test). Extend named
 * exports only when a typechecked consumer needs them.
 */

/** Parsed HANDOFF machine fields (presence-based; keys optional). */
export type HandoffMarkdown = {
  plan?: string;
  planPath?: string;
  lastUpdated?: string;
  mode?: string;
  phaseCompleted?: string;
  nextPhase?: string;
  completedTodos?: string;
  nextTodos?: string;
  parkedPlansRaw?: string;
  parkedPlans?: string[];
  backlogPlansRaw?: string;
  backlogPlans?: string[];
  runQueueRaw?: string;
  runQueue?: string[];
  queueCursor?: number | null;
  queueCursorPlan?: string | null;
  queueStatus?: string;
  queueOutcomesRaw?: string;
  queueOutcomes?: Record<string, string>;
  gaps?: string;
  instruction?: string;
  [key: string]: unknown;
};

export function parseHandoffMarkdown(content: string): HandoffMarkdown | null;
