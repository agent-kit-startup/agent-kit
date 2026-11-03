export const RULES_CAP: number;
export const DECISION_INDEX_CAP: number;
export const DOC_READ_MAX_BYTES: number;
export const DOC_TITLE_MAX: number;
export const DOC_DESCRIPTION_MAX: number;
export const DOC_STATUS_TEXT_MAX: number;
export const DOC_TAGS_MAX: number;
export const DOC_TAG_MAX: number;
export const DECISION_STATUSES: readonly ["proposed", "accepted", "deprecated", "superseded"];

export type DecisionStatus = "proposed" | "accepted" | "deprecated" | "superseded" | "unknown";

export interface RuleDoc {
  id: string;
  file: string;
  /** Repo-relative, `.cursor/rules/<file>`. */
  path: string;
  description: string;
  alwaysApply: boolean;
  globs: string[];
}

export interface RuleEntry extends RuleDoc {
  kitManaged: boolean;
  modifiedAt: string | null;
}

export interface DecisionDoc {
  id: string;
  /** Repo-relative, `.cursor/memory/decisions/<file>`. */
  path: string;
  title: string;
  date: string;
  status: DecisionStatus;
  statusText: string;
  tags: string[];
  /** Dates of the `## Amend (...)` headings, ascending. */
  amends: string[];
}

export interface DecisionIndexEntry extends DecisionDoc {
  modifiedAt: string | null;
}

export function parseRuleFile(file: string, raw: string | null): RuleDoc;
export function collectRules(root: string, opts?: { kitPaths?: Set<string> }): RuleEntry[];
export function decisionStatus(text: string): DecisionStatus;
export function parseDecisionFile(file: string, raw: string | null): DecisionDoc;
export function collectDecisionIndex(root: string): DecisionIndexEntry[];
