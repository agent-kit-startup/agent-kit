/**
 * Per-plan ship decisions for `/run-plan-all`.
 *
 * The queue confirm is the production yes. Each completed plan with a
 * product diff gets one SemVer close. The next plan starts only after
 * that ship is Done. A completed plan with no product diff skips the
 * release and the cursor advances. So does a plan whose public
 * `[Unreleased]` notes are empty (private-fence only). A red public lane
 * stops the queue. A stale row after a green producing step is converging:
 * poll with bounded backoff; never cut another tag.
 *
 * Intake runbook (`run-plan-all-intake-runbook.ts`): PO synthesis records
 * per-plan ship expectations; call `consultAfterShipLane` before any Ask.
 */

import { fetchLatestNpmDistTag, normalizeSemver } from "../lifecycle/check-updates.js";

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

/** Eventually-consistent post-prod rows that may poll after a green producing step. */
export type ShipConvergingRow = "npm" | "release-latest" | "landing";

export type ShipDoneInput = {
  privateMainHasTag: boolean;
  /** Pass true when this repo has no npm publish lane. */
  npmMatches: boolean;
  /**
   * True when publish-npm is green (or the lane is N/A).
   * False when that producing step is red. Red stays a stop.
   */
  publishNpmGreen: boolean;
  /** Pass true when this repo has no public sync PR lane. */
  publicSyncMerged: boolean;
  /**
   * True when sync-public is green (or the lane is N/A).
   * False when that producing step is red.
   */
  syncPublicGreen: boolean;
  /** Pass true when this repo has no public Release Latest lane. */
  releaseLatestMatches: boolean;
  /**
   * True when sync-landing is green (or the lane is N/A).
   * False when that producing step is red. Live HTML lag is `landingMatches`.
   */
  syncLandingGreen: boolean;
  /**
   * True when live landing HTML matches the release (or the lane is N/A).
   * Stale HTML after a green sync-landing is converging, not a stop.
   */
  landingMatches: boolean;
};

export type ShipDoneResult = {
  done: boolean;
  converging: boolean;
  reason: string;
  convergingRows: readonly ShipConvergingRow[];
};

/** Default bounded poll window for stale-after-green rows (20 minutes). */
export const DEFAULT_SHIP_CONVERGE_WINDOW_MS = 20 * 60 * 1000;

/** Default delay between poll attempts. */
export const DEFAULT_SHIP_CONVERGE_DELAY_MS = 15_000;

export function shipConvergeAttempts(
  windowMs: number = DEFAULT_SHIP_CONVERGE_WINDOW_MS,
  delayMs: number = DEFAULT_SHIP_CONVERGE_DELAY_MS,
): number {
  const window = Math.max(0, Number(windowMs) || 0);
  const delay = Math.max(1, Number(delayMs) || 1);
  return Math.max(1, Math.ceil(window / delay));
}

/**
 * Done when every applicable lane agrees. Converging when a row is stale
 * after its producing step is green (poll; never cut another tag). A red
 * producing step is unfinished (stop), not converging.
 */
export function decideShipDone(input: ShipDoneInput): ShipDoneResult {
  if (!input.privateMainHasTag) {
    return { done: false, converging: false, reason: "ship_unfinished", convergingRows: [] };
  }
  if (!input.publishNpmGreen || !input.syncPublicGreen || !input.syncLandingGreen) {
    return { done: false, converging: false, reason: "ship_red", convergingRows: [] };
  }
  if (!input.publicSyncMerged) {
    return { done: false, converging: false, reason: "ship_unfinished", convergingRows: [] };
  }

  const convergingRows: ShipConvergingRow[] = [];
  if (!input.npmMatches) convergingRows.push("npm");
  if (!input.releaseLatestMatches) convergingRows.push("release-latest");
  if (!input.landingMatches) convergingRows.push("landing");

  if (convergingRows.length > 0) {
    return { done: false, converging: true, reason: "converging", convergingRows };
  }
  return { done: true, converging: false, reason: "done", convergingRows: [] };
}

function shipDoneFlag(shipDone: boolean | ShipDoneResult): boolean {
  return typeof shipDone === "boolean" ? shipDone : shipDone.done;
}

function shipConvergingFlag(shipDone: boolean | ShipDoneResult): boolean {
  return typeof shipDone === "boolean" ? false : shipDone.converging;
}

/**
 * Advance only after a completed plan's ship is skipped for a benign reason
 * or the ship is Done. Call this only after a valid summary. Blocked and
 * partial plans use the existing stop table and must not call this as a yes.
 * Converging holds the cursor (poll); it is not an advance and not a red stop.
 */
export function decideAdvanceAfterShip(
  decision: ShipLaneDecision,
  shipDone: boolean | ShipDoneResult,
): { advance: boolean; reason: string } {
  if (
    decision.action === "skip" &&
    (decision.reason === "plans_only" ||
      decision.reason === "staging_not_ahead" ||
      decision.reason === "no_product_diff")
  ) {
    return { advance: true, reason: decision.reason };
  }
  if (
    (decision.action === "ship-patch" || decision.action === "ship-minor") &&
    shipDoneFlag(shipDone)
  ) {
    return { advance: true, reason: "ship_done" };
  }
  if (decision.action === "ship-patch" || decision.action === "ship-minor") {
    if (shipConvergingFlag(shipDone)) {
      return { advance: false, reason: "converging" };
    }
    return { advance: false, reason: "ship_not_done" };
  }
  return { advance: false, reason: decision.reason };
}

export type WaitForPublicLatestFn = (opts: {
  expectedVersion: string;
  fetchLatest: () => string;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => void;
}) => string;

export type ShipConvergeOk<T extends string = string> = { ok: true; value: T };
export type ShipConvergeTimeout = { ok: false; reason: "timeout" };

/**
 * Poll npm `dist-tags.latest` until it matches, reusing `fetchLatestNpmDistTag`.
 * Read-only. Never publishes or cuts a tag. Ask only when this returns timeout.
 */
export async function waitForShipNpmLatest(opts: {
  expectedVersion: string;
  fetchLatest?: () => Promise<string | null>;
  windowMs?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ShipConvergeOk | ShipConvergeTimeout> {
  const delayMs = opts.delayMs ?? DEFAULT_SHIP_CONVERGE_DELAY_MS;
  const windowMs = opts.windowMs ?? DEFAULT_SHIP_CONVERGE_WINDOW_MS;
  const attempts = shipConvergeAttempts(windowMs, delayMs);
  const fetchLatest = opts.fetchLatest ?? fetchLatestNpmDistTag;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const want = normalizeSemver(opts.expectedVersion);
  if (!want) return { ok: false, reason: "timeout" };

  for (let i = 0; i < attempts; i++) {
    const got = await fetchLatest();
    if (got === want) return { ok: true, value: got };
    if (i < attempts - 1) await sleep(delayMs);
  }
  return { ok: false, reason: "timeout" };
}

/**
 * Poll public Release Latest via `waitForPublicLatest`
 * (`scripts/lib/sync-landing-release.mjs`). Pass that helper in; do not
 * reimplement fetch. Read-only. Never cuts a tag.
 */
export function waitForShipReleaseLatest(opts: {
  expectedVersion: string;
  fetchLatest: () => string;
  waitForPublicLatest: WaitForPublicLatestFn;
  windowMs?: number;
  delayMs?: number;
  sleep?: (ms: number) => void;
}): ShipConvergeOk | ShipConvergeTimeout {
  const delayMs = opts.delayMs ?? DEFAULT_SHIP_CONVERGE_DELAY_MS;
  const windowMs = opts.windowMs ?? DEFAULT_SHIP_CONVERGE_WINDOW_MS;
  const attempts = shipConvergeAttempts(windowMs, delayMs);
  try {
    const tag = opts.waitForPublicLatest({
      expectedVersion: opts.expectedVersion,
      fetchLatest: opts.fetchLatest,
      attempts,
      delayMs,
      sleep: opts.sleep,
    });
    return { ok: true, value: tag };
  } catch {
    return { ok: false, reason: "timeout" };
  }
}

/**
 * Poll any eventually-consistent row (for example live landing HTML) with the
 * same bounded backoff window. `matches` must be read-only. Never cuts a tag.
 */
export async function waitForShipRowMatch(opts: {
  matches: () => boolean | Promise<boolean>;
  windowMs?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ ok: true } | ShipConvergeTimeout> {
  const delayMs = opts.delayMs ?? DEFAULT_SHIP_CONVERGE_DELAY_MS;
  const windowMs = opts.windowMs ?? DEFAULT_SHIP_CONVERGE_WINDOW_MS;
  const attempts = shipConvergeAttempts(windowMs, delayMs);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let i = 0; i < attempts; i++) {
    if (await opts.matches()) return { ok: true };
    if (i < attempts - 1) await sleep(delayMs);
  }
  return { ok: false, reason: "timeout" };
}
