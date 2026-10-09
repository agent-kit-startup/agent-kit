/** Ambient types for dashboard/lib/run-logs.mjs (consumed by CLI TypeScript). */

export const MAX_RUN_LOGS: 10;
export const MAX_RUN_LOG_BYTES: number;
export const MAX_RUN_LOG_TEXT: 600;

export interface RunLogSummary {
  format: "stream-json" | "codex" | "acp" | null;
  sessionId: string | null;
  events: number;
  lastText: string;
  result: { isError: boolean; subtype: string | null; text: string } | null;
  sentinel: string | null;
  gates: string[];
  replies: string[];
}

export interface RunLogRow extends RunLogSummary {
  id: string;
  kind: "tick" | "run";
  path: string;
  updatedAt: string;
  bytes: number;
  source: "loop-logs";
}

export function resolveRunnerStateDir(
  env?: Record<string, string | undefined>,
): ".cursor" | ".agent-kit";
export function summarizeRunLog(text: string, redact?: (s: string) => string): RunLogSummary;
export function collectRunLogs(
  root: string,
  opts?: { stateDir?: string; redact?: (s: string) => string; max?: number },
): RunLogRow[];
