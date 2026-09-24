/**
 * Per-plan ship decisions for `/run-plan-all`.
 *
 * The queue confirm is the production yes. Each completed plan with a
 * product diff gets one SemVer close. The next plan starts only after
 * that ship is Done. A completed plan with no product diff skips the
 * release and the cursor advances. So does a plan whose public
 * `[Unreleased]` notes are empty (private-fence only). A red public lane stops the queue.
 * It does not authorize another tag.
 */

export const PER_PLAN_RELEASE_LABELS = [
  "Run as proposed",
  "Edit order",
  "Apply merges & drops only",
  "Keep all plans as-is",
] as const;

export const PLANS_ONLY_LABEL = "Run plans only";

export type ShipAuth = "per-plan-release" | "plans-only";

export type ReleaseBump = "patch" | "minor" | "stop-breaking";

export type ShipLaneAction =
  | "skip"
  | "wait-ci"
  | "dispatch-ci-fix"
  | "ship-patch"
  | "ship-minor"
  | "stop";

export type ShipLaneInput = {
  auth: ShipAuth;
  outcome: "completed" | "blocked" | "partial";
  /**
   * False when the completed plan has no versionable product diff.
   * That skips the release and advances. It is not `staging_not_ready`.
   */
  productDiff: boolean;
  /**
   * Public `[Unreleased]` CHANGELOG extract:
   * `extractPublicReleaseNotes(changelog, "Unreleased")` from
   * `scripts/lib/public-changelog.mjs` (or stdout of
   * `node scripts/public-changelog.mjs --version Unreleased`).
   * Null or blank when the section is missing or every bullet is inside a
   * changelog-private fence. That is `no_product_diff`: a release with no
   * public notes fails tag CI `sync-landing` closed.
   */
  publicUnreleasedNotes: string | null;
  /** False when a product diff exists and did not land on staging. */
  stagingReady: boolean;
  stagingAheadOfMain: boolean;
  ci: "green" | "red" | "pending";
  /** CI remediation Tasks already used for this plan. Cap is one. */
  ciFixAttempts: number;
  /** `none` when this queue has not shipped yet. */
  previousShip: "none" | "done" | "stopped";
  /** `git log origin/main..origin/staging` subjects and bodies. Empty means unreadable. */
  subjects: readonly string[];
};

export type ShipLaneDecision = {
  action: ShipLaneAction;
  reason: string;
  bump?: "patch" | "minor";
};

const BREAKING_SUBJECT = /^[a-zA-Z]+(?:\([^)\n]+\))?!:/;
const FEAT_SUBJECT = /^feat(?:\([^)\n]+\))?:/;
const BREAKING_BODY = /BREAKING CHANGE/;

export function shipAuthFromConfirmLabel(label: string): ShipAuth | null {
  if (label === PLANS_ONLY_LABEL) return "plans-only";
  if ((PER_PLAN_RELEASE_LABELS as readonly string[]).includes(label)) return "per-plan-release";
  return null;
}

/** Missing or unknown HANDOFF Ship auth stays plans-only (no surprise promote). */
export function shipAuthFromHandoff(value: string | null | undefined): ShipAuth {
  return value === "per-plan-release" ? "per-plan-release" : "plans-only";
}

export function classifyReleaseBump(messages: readonly string[]): ReleaseBump {
  let feat = false;
  for (const raw of messages) {
    const text = raw.trim();
    if (!text) continue;
    const subject = text.split(/\r?\n/, 1)[0] ?? text;
    if (BREAKING_SUBJECT.test(subject) || BREAKING_BODY.test(text)) return "stop-breaking";
    if (FEAT_SUBJECT.test(subject)) feat = true;
  }
  return feat ? "minor" : "patch";
}

export function decideShipLane(input: ShipLaneInput): ShipLaneDecision {
  if (input.auth === "plans-only") return { action: "skip", reason: "plans_only" };
  if (input.previousShip === "stopped") return { action: "stop", reason: "previous_ship_not_done" };
  if (input.outcome !== "completed") return { action: "skip", reason: "plan_not_completed" };
  if (!input.productDiff || !input.publicUnreleasedNotes?.trim()) {
    return { action: "skip", reason: "no_product_diff" };
  }
  if (!input.stagingReady) return { action: "stop", reason: "staging_not_ready" };
  if (!input.stagingAheadOfMain) return { action: "skip", reason: "staging_not_ahead" };
  if (input.ci === "pending") return { action: "wait-ci", reason: "ci_pending" };
  if (input.ci === "red") {
    if (input.ciFixAttempts < 1) return { action: "dispatch-ci-fix", reason: "ci_red_one_fix" };
    return { action: "stop", reason: "ci_still_red" };
  }
  if (input.subjects.length === 0) return { action: "stop", reason: "subjects_unknown" };
  const bump = classifyReleaseBump(input.subjects);
  if (bump === "stop-breaking") return { action: "stop", reason: "breaking_needs_operator" };
  if (bump === "minor") return { action: "ship-minor", bump: "minor", reason: "feat_subjects" };
  return { action: "ship-patch", bump: "patch", reason: "no_feat_subjects" };
}

export type ShipDoneInput = {
  privateMainHasTag: boolean;
  /** Pass true when this repo has no npm publish lane. */
  npmMatches: boolean;
  /** Pass true when this repo has no public sync PR lane. */
  publicSyncMerged: boolean;
  /** Pass true when this repo has no public Release Latest lane. */
  releaseLatestMatches: boolean;
  /** Pass true when this repo has no landing sync lane. */
  syncLandingGreen: boolean;
};

export function decideShipDone(input: ShipDoneInput): { done: boolean; reason: string } {
  const done =
    input.privateMainHasTag &&
    input.npmMatches &&
    input.publicSyncMerged &&
    input.releaseLatestMatches &&
    input.syncLandingGreen;
  return done ? { done: true, reason: "done" } : { done: false, reason: "ship_unfinished" };
}

/**
 * Advance only after a completed plan's ship is skipped for a benign reason
 * or the ship is Done. Call this only after a valid summary. Blocked and
 * partial plans use the existing stop table and must not call this as a yes.
 */
export function decideAdvanceAfterShip(
  decision: ShipLaneDecision,
  shipDone: boolean,
): { advance: boolean; reason: string } {
  if (
    decision.action === "skip" &&
    (decision.reason === "plans_only" ||
      decision.reason === "staging_not_ahead" ||
      decision.reason === "no_product_diff")
  ) {
    return { advance: true, reason: decision.reason };
  }
  if ((decision.action === "ship-patch" || decision.action === "ship-minor") && shipDone) {
    return { advance: true, reason: "ship_done" };
  }
  if (decision.action === "ship-patch" || decision.action === "ship-minor") {
    return { advance: false, reason: "ship_not_done" };
  }
  return { advance: false, reason: decision.reason };
}
