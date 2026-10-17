/** Ambient types for dashboard/lib/gate-exit-tickets.mjs (consumed by CLI TypeScript). */

export const GATE_EXIT_BRANCH_PREFIX: "gate-exit/";
export const GATE_EXIT_MARKER_RELPATH: ".cursor/context/gate-exit.json";
export const GATE_EXIT_NOTE_DIR: ".cursor/gate-exit";
export const GATE_EXIT_DEFAULT_BASE: "staging";
export const GATE_EXIT_STAMP_RE: RegExp;
export const MAX_GATE_EXIT_TICKETS: 10;
export const MAX_GATE_EXIT_SKIPPED: 5;
export const MAX_GATE_EXIT_TEXT: 300;

export type GitRunner = (args: string[]) => { code: number; stdout: string };

export interface GateExitTicketRow {
  stamp: string;
  headline: string | null;
  askId: string | null;
  labels: string[];
  trigger: "gate" | "stopped-by-operator" | "failure" | null;
  openedAt: string | null;
  url: string | null;
  branch: string | null;
  branchState: "unmerged" | "merged" | "none";
  inMarker: boolean;
}

export interface GateExitTickets {
  marker: "absent" | "ok" | "invalid";
  base: string;
  tickets: GateExitTicketRow[];
  skipped: string[];
  truncated: boolean;
}

export function makeGitRunner(root: string, timeoutMs?: number): GitRunner;
export function readGateExitMarkerSync(
  root: string,
):
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "ok"; pending: Record<string, unknown>[]; skipped: string[] };
export function collectGateExitTickets(
  root: string,
  opts?: { git?: GitRunner; redact?: (s: string) => string; max?: number },
): GateExitTickets;
