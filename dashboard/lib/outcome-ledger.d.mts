/** Ambient types for dashboard/lib/outcome-ledger.mjs (consumed by CLI TypeScript). */

export const OUTCOME_LEDGER_REL: ".cursor/context/outcome-ledger.json";
export const TEST_RESULTS_REL: ".cursor/context/test-results.json";
export const REPOSITORY_PROFILE_REL: ".cursor/agent-kit.config.json";
export const OUTCOME_LEDGER_VERSION: 1;
export const MAX_LEDGER_ENTRIES: number;
export const MAX_TEST_RESULTS: number;
export const MAX_RECENT_ENTRIES: number;

export type OutcomeKind =
  | "todo"
  | "test"
  | "ci"
  | "releaseCut"
  | "plan"
  | "review"
  | "releasePublished";
export type OutcomeResource = "logic" | "compute" | "rare";
export const OUTCOME_KINDS: Readonly<Record<OutcomeKind, OutcomeResource>>;

export interface OutcomeEntry {
  /** A kind from a newer engine is kept with resource null and not counted. */
  kind: OutcomeKind | string;
  resource: OutcomeResource | null;
  at: string | null;
  label: string;
}
export interface OutcomeEvent extends OutcomeEntry {
  key: string;
}
export interface OutcomeLedger {
  version: 1;
  entries: Record<string, OutcomeEntry>;
  sources: Record<string, string>;
}
export interface FlowSignal {
  plan: string;
  streak: number;
  lastClosedAt: string | null;
  brokenAt: string | null;
}
export interface TestRun {
  at: string;
  ok: boolean;
  exitCode: number | null;
  head: string | null;
  commands: string[];
}
export interface TestResults {
  version: 1;
  runs: TestRun[];
}
export interface TestCollectorStatus {
  configured: boolean;
  lastRun: { at: string; ok: boolean; head: string | null } | null;
}
export interface OutcomeLedgerSummary {
  available: boolean;
  reason: string | null;
  version: 1;
  path: string;
  entries: number;
  totals: Record<OutcomeResource, number>;
  byKind: Record<OutcomeKind, number>;
  recent: OutcomeEvent[];
  flow: FlowSignal | null;
  tests: TestCollectorStatus;
}

export function emptyOutcomeLedger(): OutcomeLedger;
export function parseOutcomeLedger(raw: unknown): OutcomeLedger;
export function serializeOutcomeLedger(ledger: unknown): string;
export function parsePlanTodos(content: string): Array<{ id: string; status: string }>;
export function fullReviewHeadSha(content: string): string | null;
export function extractOutcomeEvents(inputs?: Record<string, unknown>): OutcomeEvent[];
export function foldOutcomeLedger(
  prev: unknown,
  events: OutcomeEvent[],
  sources?: Record<string, string>,
): { ledger: OutcomeLedger; added: number };
export function deriveFlowSignal(
  timing: unknown,
  runLogs?: unknown[],
  plans?: Array<{ file: string; todos: Array<{ id: string; status: string }> }> | null,
): FlowSignal | null;
export function summarizeOutcomeLedger(
  ledger: unknown,
  extras?: {
    available?: boolean;
    reason?: string | null;
    flow?: FlowSignal | null;
    tests?: TestCollectorStatus;
  },
): OutcomeLedgerSummary;
export function emptyOutcomeLedgerSummary(reason?: string | null): OutcomeLedgerSummary;
export function readOutcomeLedger(root: string): OutcomeLedger;
export function readOutcomeLedgerFile(root: string): { ledger: OutcomeLedger; foldable: boolean };
export function isFoldableOutcomeLedger(raw: unknown): boolean;
export function persistOutcomeLedger(root: string, ledger: unknown): boolean;
export function parseTestResults(raw: unknown): TestResults;
export function readTestResults(root: string): TestResults;
export function appendTestResult(root: string, run: TestRun): TestResults;
export function readProfileTestCommands(root: string): string[];
export function testCollectorStatus(root: string, testResults: TestResults): TestCollectorStatus;
export function runAndRecordTests(
  root: string,
  opts?: {
    commands?: string[];
    spawn?: (...args: unknown[]) => { status: number | null; stdout?: unknown };
    stdio?: unknown;
    now?: Date;
    onCommand?: (command: string) => void;
  },
): { status: "no-commands" } | { status: "recorded"; run: TestRun };
