import { describe, expect, it } from "vitest";
import {
  DEFAULT_KNOWN_SHIP_RECOVERIES,
  NOVEL_SHIP_FAILURE_ASK_LABELS,
  buildIntakeShipRunbook,
  buildPlanShipExpectations,
  consultAfterShipLane,
  consultIntakeShipRunbook,
  lookupPlanShipExpectations,
  parseIntakeShipRunbook,
  serializeIntakeShipRunbook,
  shipFailureFromLane,
} from "./run-plan-all-intake-runbook.js";

describe("buildPlanShipExpectations", () => {
  it("records public notes, landing, transients, and default recoveries", () => {
    const plan = buildPlanShipExpectations({
      planBasename: "fix-queue.plan.md",
      publicNotes: true,
      landingTouched: true,
    });
    expect(plan).toEqual({
      planBasename: "fix-queue.plan.md",
      publicNotes: true,
      landingTouched: true,
      expectedTransientRows: ["npm", "release-latest", "landing"],
      knownRecoveries: [...DEFAULT_KNOWN_SHIP_RECOVERIES],
    });
  });

  it("omits landing from default transients when landing was not touched", () => {
    const plan = buildPlanShipExpectations({
      planBasename: "docs-only.plan.md",
      publicNotes: false,
      landingTouched: false,
    });
    expect(plan.publicNotes).toBe(false);
    expect(plan.expectedTransientRows).toEqual(["npm", "release-latest"]);
  });

  it("looks up a plan inside the queue runbook", () => {
    const runbook = buildIntakeShipRunbook([
      { planBasename: "a.plan.md", landingTouched: false },
      { planBasename: "b.plan.md", landingTouched: true },
    ]);
    expect(lookupPlanShipExpectations(runbook, "b.plan.md")?.landingTouched).toBe(true);
    expect(lookupPlanShipExpectations(runbook, "missing.plan.md")).toBeNull();
  });
});

describe("consultIntakeShipRunbook", () => {
  const expectations = buildPlanShipExpectations({ planBasename: "q.plan.md" });

  it("self-recovers known paths before any Ask", () => {
    expect(consultIntakeShipRunbook({ failure: "ci_red", expectations, ciFixAttempts: 0 })).toEqual(
      {
        handling: "self_recover",
        recovery: "ci_fix_once",
        reason: "ci_red_one_fix",
      },
    );
    expect(consultIntakeShipRunbook({ failure: "no_product_diff", expectations })).toEqual({
      handling: "advance",
      reason: "no_product_diff",
    });
    expect(consultIntakeShipRunbook({ failure: "hold_applicable", expectations })).toEqual({
      handling: "self_recover",
      recovery: "hold_path",
      reason: "hold_path",
    });
    expect(consultIntakeShipRunbook({ failure: "release_preflight_fail", expectations })).toEqual({
      handling: "self_recover",
      recovery: "release_preflight",
      reason: "release_preflight_fix_notes",
    });
    expect(consultIntakeShipRunbook({ failure: "converging", expectations })).toEqual({
      handling: "self_recover",
      recovery: "converging_poll",
      reason: "converging",
    });
  });

  it("uses default recoveries when PO did not record a plan entry", () => {
    expect(consultIntakeShipRunbook({ failure: "converging", expectations: null })).toEqual({
      handling: "self_recover",
      recovery: "converging_poll",
      reason: "converging",
    });
  });

  it("Asks once with concrete options on novel or exhausted failures", () => {
    expect(consultIntakeShipRunbook({ failure: "ci_still_red", expectations })).toEqual({
      handling: "ask",
      reason: "ci_still_red",
      labels: [...NOVEL_SHIP_FAILURE_ASK_LABELS],
    });
    expect(consultIntakeShipRunbook({ failure: "converge_timeout", expectations })).toEqual({
      handling: "ask",
      reason: "converge_timeout",
      labels: [...NOVEL_SHIP_FAILURE_ASK_LABELS],
    });
    expect(consultIntakeShipRunbook({ failure: "staging_not_ready", expectations })).toEqual({
      handling: "ask",
      reason: "staging_not_ready",
      labels: [...NOVEL_SHIP_FAILURE_ASK_LABELS],
    });
    expect(consultIntakeShipRunbook({ failure: "novel", expectations })).toEqual({
      handling: "ask",
      reason: "novel",
      labels: [...NOVEL_SHIP_FAILURE_ASK_LABELS],
    });
  });

  it("stops on a red producing step and does not poll it into success", () => {
    expect(consultIntakeShipRunbook({ failure: "ship_red", expectations })).toEqual({
      handling: "stop",
      reason: "ship_red",
    });
  });
});

describe("consultAfterShipLane", () => {
  const expectations = buildPlanShipExpectations({ planBasename: "q.plan.md" });

  it("maps lane reasons onto runbook handling", () => {
    expect(shipFailureFromLane({ laneReason: "ci_red_one_fix" })).toBe("ci_red");
    expect(
      consultAfterShipLane({
        laneReason: "ci_red_one_fix",
        expectations,
        ciFixAttempts: 0,
      }),
    ).toEqual({
      handling: "self_recover",
      recovery: "ci_fix_once",
      reason: "ci_red_one_fix",
    });
    expect(
      consultAfterShipLane({
        laneReason: "ship_not_done",
        converging: true,
        expectations,
      }),
    ).toEqual({
      handling: "self_recover",
      recovery: "converging_poll",
      reason: "converging",
    });
    expect(
      consultAfterShipLane({
        laneReason: "converging",
        convergeTimedOut: true,
        expectations,
      }),
    ).toEqual({
      handling: "ask",
      reason: "converge_timeout",
      labels: [...NOVEL_SHIP_FAILURE_ASK_LABELS],
    });
    expect(consultAfterShipLane({ laneReason: "no_feat_subjects", expectations })).toBeNull();
  });
});

describe("serialize and parse intake ship runbook", () => {
  it("round-trips through HANDOFF JSON", () => {
    const runbook = buildIntakeShipRunbook([
      {
        planBasename: "a.plan.md",
        publicNotes: true,
        landingTouched: false,
        expectedTransientRows: ["npm"],
      },
      { planBasename: "b.plan.md", publicNotes: false, landingTouched: true },
    ]);
    const raw = serializeIntakeShipRunbook(runbook);
    const parsed = parseIntakeShipRunbook(raw);
    expect(parsed).not.toBeNull();
    expect(lookupPlanShipExpectations(parsed, "a.plan.md")?.expectedTransientRows).toEqual(["npm"]);
    expect(lookupPlanShipExpectations(parsed, "b.plan.md")?.landingTouched).toBe(true);
    expect(lookupPlanShipExpectations(parsed, "b.plan.md")?.publicNotes).toBe(false);
    expect(parseIntakeShipRunbook("")).toBeNull();
    expect(parseIntakeShipRunbook("{not-json")).toBeNull();
  });
});
