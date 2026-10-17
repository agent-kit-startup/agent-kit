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

/** Flight Log pending operator tickets lane (read-only rows). */
export type FlightLogTicket = {
  id: string;
  stamp: string;
  title: string;
  text: string;
  askId: string | null;
  branch: string | null;
  branchState: "unmerged" | "merged" | "none";
  url: string | null;
  triage: string;
  sourcePath: string;
};

export const FLIGHT_LOG_TICKETS_CAP: 5;

export function buildFlightLogTickets(
  tickets: Record<string, unknown>[] | null | undefined,
  opts?: { cap?: number },
): FlightLogTicket[];
