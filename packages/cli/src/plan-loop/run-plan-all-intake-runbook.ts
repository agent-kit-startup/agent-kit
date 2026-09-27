/**
 * Intake-to-execution ship runbook for `/run-plan-all`.
 *
 * PO synthesis records per queued plan the ship expectations found by Broad
 * Intake. The ship lane and tick consult this runbook and self-recover before
 * any Ask. Known recoveries: one CI fix + rerun, hold path, no_product_diff,
 * release-preflight, and the converging poll. A novel failure Asks once with
 * concrete options. Red producing steps stay a stop.
 */

import type { ShipConvergingRow } from "./run-plan-all-ship-lane.js";

export type KnownShipRecovery =
  | "ci_fix_once"
  | "hold_path"
  | "no_product_diff"
  | "release_preflight"
  | "converging_poll";

/** Failures the ship lane / tick may classify when consulting the runbook. */
export type ShipFailureKind =
  | "ci_red"
  | "ci_still_red"
  | "staging_not_ready"
  | "no_product_diff"
  | "converging"
  | "converge_timeout"
  | "ship_red"
  | "release_preflight_fail"
  | "hold_applicable"
  | "novel";

export type PlanShipExpectations = {
  planBasename: string;
  /** True when a release for this plan needs public CHANGELOG notes. */
  publicNotes: boolean;
  /** True when Broad Intake found landing / sync-landing touch. */
  landingTouched: boolean;
  /** Rows expected to lag after a green producing step. */
  expectedTransientRows: readonly ShipConvergingRow[];
  /** Recoveries allowed before any Ask. */
  knownRecoveries: readonly KnownShipRecovery[];
};

export type IntakeShipRunbook = {
  plans: readonly PlanShipExpectations[];
};

export type IntakeShipFinding = {
  planBasename: string;
  publicNotes?: boolean;
  landingTouched?: boolean;
  expectedTransientRows?: readonly ShipConvergingRow[];
  knownRecoveries?: readonly KnownShipRecovery[];
};

export type ShipConsultDecision =
  | { handling: "self_recover"; recovery: KnownShipRecovery; reason: string }
  | { handling: "advance"; reason: string }
  | { handling: "stop"; reason: string }
  | {
      handling: "ask";
      reason: string;
      labels: readonly ["Retry recovery once", "Hold and document", "Stop the queue"];
    };

export const DEFAULT_KNOWN_SHIP_RECOVERIES: readonly KnownShipRecovery[] = [
  "ci_fix_once",
  "hold_path",
  "no_product_diff",
  "release_preflight",
  "converging_poll",
] as const;

export const NOVEL_SHIP_FAILURE_ASK_LABELS = [
  "Retry recovery once",
  "Hold and document",
  "Stop the queue",
] as const;

const RECOVERY_SET = new Set<string>(DEFAULT_KNOWN_SHIP_RECOVERIES);
const TRANSIENT_SET = new Set<string>(["npm", "release-latest", "landing"]);

function uniqueRecoveries(
  extra: readonly KnownShipRecovery[] | undefined,
): readonly KnownShipRecovery[] {
  const out: KnownShipRecovery[] = [];
  const seen = new Set<string>();
  for (const item of [...DEFAULT_KNOWN_SHIP_RECOVERIES, ...(extra ?? [])]) {
    if (!RECOVERY_SET.has(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function uniqueTransientRows(
  rows: readonly ShipConvergingRow[] | undefined,
  landingTouched: boolean,
): readonly ShipConvergingRow[] {
  const base: ShipConvergingRow[] =
    rows != null
      ? [...rows]
      : landingTouched
        ? ["npm", "release-latest", "landing"]
        : ["npm", "release-latest"];
  const out: ShipConvergingRow[] = [];
  const seen = new Set<string>();
  for (const row of base) {
    if (!TRANSIENT_SET.has(row) || seen.has(row)) continue;
    seen.add(row);
    out.push(row);
  }
  return out;
}

function hasRecovery(
  expectations: PlanShipExpectations | null | undefined,
  recovery: KnownShipRecovery,
): boolean {
  const list = expectations?.knownRecoveries ?? DEFAULT_KNOWN_SHIP_RECOVERIES;
  return list.includes(recovery);
}

function askOnce(reason: string): ShipConsultDecision {
  return { handling: "ask", reason, labels: NOVEL_SHIP_FAILURE_ASK_LABELS };
}

/**
 * Build one plan's ship expectations from Broad Intake / PO findings.
 * Defaults include the known self-recoveries and typical transient rows.
 */
export function buildPlanShipExpectations(finding: IntakeShipFinding): PlanShipExpectations {
  const basename = finding.planBasename.trim();
  const landingTouched = finding.landingTouched === true;
  const publicNotes = finding.publicNotes !== false;
  return {
    planBasename: basename,
    publicNotes,
    landingTouched,
    expectedTransientRows: uniqueTransientRows(finding.expectedTransientRows, landingTouched),
    knownRecoveries: uniqueRecoveries(finding.knownRecoveries),
  };
}

/** Build a full queue runbook from per-plan findings (PO synthesis output). */
export function buildIntakeShipRunbook(findings: readonly IntakeShipFinding[]): IntakeShipRunbook {
  return { plans: findings.map(buildPlanShipExpectations) };
}

export function lookupPlanShipExpectations(
  runbook: IntakeShipRunbook | null | undefined,
  planBasename: string,
): PlanShipExpectations | null {
  if (!runbook?.plans?.length) return null;
  const want = planBasename.trim();
  return runbook.plans.find((p) => p.planBasename === want) ?? null;
}

/**
 * Consult the intake runbook before any Ask. Known recoveries self-recover;
 * a red producing step stops; everything else Asks once with concrete labels.
 */
export function consultIntakeShipRunbook(input: {
  failure: ShipFailureKind;
  expectations?: PlanShipExpectations | null;
  ciFixAttempts?: number;
}): ShipConsultDecision {
  const { failure, expectations } = input;
  const ciFixAttempts = input.ciFixAttempts ?? 0;

  switch (failure) {
    case "no_product_diff":
      if (hasRecovery(expectations, "no_product_diff")) {
        return { handling: "advance", reason: "no_product_diff" };
      }
      return askOnce("no_product_diff_not_in_runbook");

    case "ci_red":
      if (hasRecovery(expectations, "ci_fix_once") && ciFixAttempts < 1) {
        return {
          handling: "self_recover",
          recovery: "ci_fix_once",
          reason: "ci_red_one_fix",
        };
      }
      return askOnce("ci_red_exhausted");

    case "ci_still_red":
      return askOnce("ci_still_red");

    case "release_preflight_fail":
      if (hasRecovery(expectations, "release_preflight")) {
        return {
          handling: "self_recover",
          recovery: "release_preflight",
          reason: "release_preflight_fix_notes",
        };
      }
      return askOnce("release_preflight_fail");

    case "hold_applicable":
      if (hasRecovery(expectations, "hold_path")) {
        return {
          handling: "self_recover",
          recovery: "hold_path",
          reason: "hold_path",
        };
      }
      return askOnce("hold_applicable");

    case "converging":
      if (hasRecovery(expectations, "converging_poll")) {
        return {
          handling: "self_recover",
          recovery: "converging_poll",
          reason: "converging",
        };
      }
      return askOnce("converging_not_in_runbook");

    case "converge_timeout":
      return askOnce("converge_timeout");

    case "ship_red":
      return { handling: "stop", reason: "ship_red" };

    case "staging_not_ready":
      return askOnce("staging_not_ready");

    case "novel":
      return askOnce("novel");

    default: {
      const _exhaustive: never = failure;
      return askOnce(String(_exhaustive));
    }
  }
}

/**
 * Map a ship-lane decision reason (and optional Done result) onto a failure
 * kind the runbook understands. Returns null when no consult is needed yet
 * (for example a clean ship-patch / wait-ci / skip plans-only).
 */
export function shipFailureFromLane(input: {
  laneReason: string;
  converging?: boolean;
  convergeTimedOut?: boolean;
}): ShipFailureKind | null {
  if (input.convergeTimedOut) return "converge_timeout";
  if (input.converging || input.laneReason === "converging") return "converging";
  switch (input.laneReason) {
    case "no_product_diff":
      return "no_product_diff";
    case "ci_red_one_fix":
      return "ci_red";
    case "ci_still_red":
      return "ci_still_red";
    case "staging_not_ready":
      return "staging_not_ready";
    case "ship_red":
      return "ship_red";
    case "ship_not_done":
      return "novel";
    default:
      return null;
  }
}

/**
 * After `decideShipLane` / `decideShipDone`, consult the intake runbook before
 * any Ask. Returns null when the lane already has a clear next action with no
 * recovery fork (ship green, wait-ci, plans-only skip, and so on).
 */
export function consultAfterShipLane(input: {
  laneReason: string;
  expectations?: PlanShipExpectations | null;
  ciFixAttempts?: number;
  converging?: boolean;
  convergeTimedOut?: boolean;
}): ShipConsultDecision | null {
  const failure = shipFailureFromLane({
    laneReason: input.laneReason,
    converging: input.converging,
    convergeTimedOut: input.convergeTimedOut,
  });
  if (failure == null) return null;
  return consultIntakeShipRunbook({
    failure,
    expectations: input.expectations,
    ciFixAttempts: input.ciFixAttempts,
  });
}

/** Compact JSON for HANDOFF (`- **Ship runbook:** ...`). */
export function serializeIntakeShipRunbook(runbook: IntakeShipRunbook): string {
  return JSON.stringify({
    plans: runbook.plans.map((p) => ({
      plan: p.planBasename,
      publicNotes: p.publicNotes,
      landingTouched: p.landingTouched,
      transient: [...p.expectedTransientRows],
      recoveries: [...p.knownRecoveries],
    })),
  });
}

/** Parse HANDOFF ship-runbook JSON. Returns null when missing or malformed. */
export function parseIntakeShipRunbook(raw: string | null | undefined): IntakeShipRunbook | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const plansRaw = (parsed as { plans?: unknown }).plans;
    if (!Array.isArray(plansRaw)) return null;
    const findings: IntakeShipFinding[] = [];
    for (const row of plansRaw) {
      if (!row || typeof row !== "object") return null;
      const rec = row as Record<string, unknown>;
      const planBasename =
        typeof rec.plan === "string"
          ? rec.plan
          : typeof rec.planBasename === "string"
            ? rec.planBasename
            : "";
      if (!planBasename.trim()) return null;
      const finding: IntakeShipFinding = { planBasename };
      if (typeof rec.publicNotes === "boolean") finding.publicNotes = rec.publicNotes;
      if (typeof rec.landingTouched === "boolean") finding.landingTouched = rec.landingTouched;
      if (Array.isArray(rec.transient) || Array.isArray(rec.expectedTransientRows)) {
        const rows = (rec.transient ?? rec.expectedTransientRows) as unknown[];
        finding.expectedTransientRows = rows.filter(
          (r): r is ShipConvergingRow => typeof r === "string" && TRANSIENT_SET.has(r),
        );
      }
      if (Array.isArray(rec.recoveries) || Array.isArray(rec.knownRecoveries)) {
        const recs = (rec.recoveries ?? rec.knownRecoveries) as unknown[];
        finding.knownRecoveries = recs.filter(
          (r): r is KnownShipRecovery => typeof r === "string" && RECOVERY_SET.has(r),
        );
      }
      findings.push(finding);
    }
    return buildIntakeShipRunbook(findings);
  } catch {
    return null;
  }
}
