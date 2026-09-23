import { describe, expect, it } from "vitest";
import {
  type ShipLaneInput,
  classifyReleaseBump,
  decideAdvanceAfterShip,
  decideShipDone,
  decideShipLane,
  shipAuthFromConfirmLabel,
  shipAuthFromHandoff,
} from "./run-plan-all-ship-lane.js";

const ready: ShipLaneInput = {
  auth: "per-plan-release",
  outcome: "completed",
  productDiff: true,
  stagingReady: true,
  stagingAheadOfMain: true,
  ci: "green",
  ciFixAttempts: 0,
  previousShip: "none",
  subjects: ["fix: close the queue gap"],
};

describe("queue confirm ship auth", () => {
  it("treats the run labels as one release per plan", () => {
    expect(shipAuthFromConfirmLabel("Run as proposed")).toBe("per-plan-release");
    expect(shipAuthFromConfirmLabel("Edit order")).toBe("per-plan-release");
    expect(shipAuthFromConfirmLabel("Apply merges & drops only")).toBe("per-plan-release");
    expect(shipAuthFromConfirmLabel("Keep all plans as-is")).toBe("per-plan-release");
  });

  it("keeps Run plans only and non-run labels off the promote path", () => {
    expect(shipAuthFromConfirmLabel("Run plans only")).toBe("plans-only");
    expect(shipAuthFromConfirmLabel("Cancel")).toBeNull();
    expect(shipAuthFromConfirmLabel("Include Gate-B plans")).toBeNull();
  });

  it("defaults a stored queue with no Ship auth to plans-only", () => {
    expect(shipAuthFromHandoff(undefined)).toBe("plans-only");
    expect(shipAuthFromHandoff("per-plan-release")).toBe("per-plan-release");
  });
});

describe("release bump", () => {
  it("ships patch without feat, minor with feat, and stops on breaking", () => {
    expect(classifyReleaseBump(["docs: refresh the queue page"])).toBe("patch");
    expect(classifyReleaseBump(["fix: ci", "feat(queue): ship per plan"])).toBe("minor");
    expect(classifyReleaseBump(["feat!: drop the old confirm"])).toBe("stop-breaking");
    expect(classifyReleaseBump(["fix: x\n\nBREAKING CHANGE: tag shape"])).toBe("stop-breaking");
  });
});

describe("ship lane", () => {
  it("skips a completed plan with no product diff and still stops an unready diff", () => {
    const empty = decideShipLane({ ...ready, productDiff: false, stagingReady: false });
    expect(empty).toEqual({ action: "skip", reason: "no_product_diff" });
    expect(decideAdvanceAfterShip(empty, false).advance).toBe(true);
    const unready = decideShipLane({ ...ready, stagingReady: false });
    expect(unready.reason).toBe("staging_not_ready");
    expect(decideAdvanceAfterShip(unready, false).advance).toBe(false);
  });

  it("skips when the operator chose plans only or staging is not ahead", () => {
    expect(decideShipLane({ ...ready, auth: "plans-only" }).reason).toBe("plans_only");
    expect(decideShipLane({ ...ready, stagingAheadOfMain: false }).reason).toBe(
      "staging_not_ahead",
    );
  });

  it("waits on pending CI and allows one fix Task", () => {
    expect(decideShipLane({ ...ready, ci: "pending" }).action).toBe("wait-ci");
    expect(decideShipLane({ ...ready, ci: "red", ciFixAttempts: 0 }).action).toBe(
      "dispatch-ci-fix",
    );
    expect(decideShipLane({ ...ready, ci: "red", ciFixAttempts: 1 }).reason).toBe("ci_still_red");
  });

  it("ships one patch or minor and refuses a second plan after a stopped ship", () => {
    expect(decideShipLane(ready)).toEqual({
      action: "ship-patch",
      bump: "patch",
      reason: "no_feat_subjects",
    });
    expect(decideShipLane({ ...ready, subjects: ["feat: queue ship"] }).action).toBe("ship-minor");
    expect(decideShipLane({ ...ready, previousShip: "stopped" }).reason).toBe(
      "previous_ship_not_done",
    );
    expect(decideShipLane({ ...ready, subjects: [] }).reason).toBe("subjects_unknown");
    expect(decideShipLane({ ...ready, subjects: ["feat!: break"] }).reason).toBe(
      "breaking_needs_operator",
    );
  });
});

describe("ship done and cursor advance", () => {
  it("is Done only when every lane that exists agrees", () => {
    expect(
      decideShipDone({
        privateMainHasTag: true,
        npmMatches: true,
        publicSyncMerged: true,
        releaseLatestMatches: true,
        syncLandingGreen: false,
      }).done,
    ).toBe(false);
    expect(
      decideShipDone({
        privateMainHasTag: true,
        npmMatches: true,
        publicSyncMerged: true,
        releaseLatestMatches: true,
        syncLandingGreen: true,
      }).reason,
    ).toBe("done");
  });

  it("advances after a benign skip or a finished ship, and holds when the ship is unfinished", () => {
    const skipped = decideShipLane({ ...ready, auth: "plans-only" });
    expect(decideAdvanceAfterShip(skipped, false).advance).toBe(true);
    const shipped = decideShipLane(ready);
    expect(decideAdvanceAfterShip(shipped, false).reason).toBe("ship_not_done");
    expect(decideAdvanceAfterShip(shipped, true).reason).toBe("ship_done");
    const stopped = decideShipLane({ ...ready, ci: "red", ciFixAttempts: 1 });
    expect(decideAdvanceAfterShip(stopped, false).advance).toBe(false);
  });
});
