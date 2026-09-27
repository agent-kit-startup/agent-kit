import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHIP_CONVERGE_DELAY_MS,
  DEFAULT_SHIP_CONVERGE_WINDOW_MS,
  type ShipDoneInput,
  type ShipLaneInput,
  type WaitForPublicLatestFn,
  classifyReleaseBump,
  decideAdvanceAfterShip,
  decideShipDone,
  decideShipLane,
  shipAuthFromConfirmLabel,
  shipAuthFromHandoff,
  shipConvergeAttempts,
  waitForShipNpmLatest,
  waitForShipReleaseLatest,
  waitForShipRowMatch,
} from "./run-plan-all-ship-lane.js";

const require = createRequire(import.meta.url);
const { waitForPublicLatest } = require("../../../../scripts/lib/sync-landing-release.mjs") as {
  waitForPublicLatest: WaitForPublicLatestFn;
};

const ready: ShipLaneInput = {
  auth: "per-plan-release",
  outcome: "completed",
  productDiff: true,
  publicUnreleasedNotes: "### Fixed\n\n- Consumer queue ships one release per plan",
  stagingReady: true,
  stagingAheadOfMain: true,
  ci: "green",
  ciFixAttempts: 0,
  previousShip: "none",
  subjects: ["fix: close the queue gap"],
};

const shipDoneReady: ShipDoneInput = {
  privateMainHasTag: true,
  npmMatches: true,
  publishNpmGreen: true,
  publicSyncMerged: true,
  syncPublicGreen: true,
  releaseLatestMatches: true,
  syncLandingGreen: true,
  landingMatches: true,
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

  it("skips a completed plan whose public [Unreleased] notes are empty (private-fence only)", () => {
    for (const publicUnreleasedNotes of [null, "", "  \n"]) {
      const privateOnly = decideShipLane({ ...ready, publicUnreleasedNotes });
      expect(privateOnly).toEqual({ action: "skip", reason: "no_product_diff" });
      expect(decideAdvanceAfterShip(privateOnly, false)).toEqual({
        advance: true,
        reason: "no_product_diff",
      });
    }
    const unready = decideShipLane({ ...ready, publicUnreleasedNotes: null, stagingReady: false });
    expect(unready.reason).toBe("no_product_diff");
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
    expect(decideShipDone({ ...shipDoneReady, landingMatches: false })).toEqual({
      done: false,
      converging: true,
      reason: "converging",
      convergingRows: ["landing"],
    });
    expect(decideShipDone(shipDoneReady)).toEqual({
      done: true,
      converging: false,
      reason: "done",
      convergingRows: [],
    });
  });

  it("converges when a row is stale after its producing step is green", () => {
    expect(decideShipDone({ ...shipDoneReady, npmMatches: false })).toEqual({
      done: false,
      converging: true,
      reason: "converging",
      convergingRows: ["npm"],
    });
    expect(decideShipDone({ ...shipDoneReady, releaseLatestMatches: false })).toEqual({
      done: false,
      converging: true,
      reason: "converging",
      convergingRows: ["release-latest"],
    });
    expect(
      decideShipDone({
        ...shipDoneReady,
        npmMatches: false,
        releaseLatestMatches: false,
        landingMatches: false,
      }).convergingRows,
    ).toEqual(["npm", "release-latest", "landing"]);
  });

  it("stops on a red producing step and does not treat it as converging", () => {
    expect(decideShipDone({ ...shipDoneReady, publishNpmGreen: false, npmMatches: false })).toEqual(
      {
        done: false,
        converging: false,
        reason: "ship_red",
        convergingRows: [],
      },
    );
    expect(
      decideShipDone({
        ...shipDoneReady,
        syncPublicGreen: false,
        releaseLatestMatches: false,
      }).reason,
    ).toBe("ship_red");
    expect(
      decideShipDone({
        ...shipDoneReady,
        syncLandingGreen: false,
        landingMatches: false,
      }).reason,
    ).toBe("ship_red");
    expect(decideShipDone({ ...shipDoneReady, publicSyncMerged: false }).reason).toBe(
      "ship_unfinished",
    );
  });

  it("advances after a benign skip or a finished ship, and holds when the ship is unfinished", () => {
    const skipped = decideShipLane({ ...ready, auth: "plans-only" });
    expect(decideAdvanceAfterShip(skipped, false).advance).toBe(true);
    const shipped = decideShipLane(ready);
    expect(decideAdvanceAfterShip(shipped, false).reason).toBe("ship_not_done");
    expect(decideAdvanceAfterShip(shipped, true).reason).toBe("ship_done");
    const converging = decideShipDone({ ...shipDoneReady, npmMatches: false });
    expect(decideAdvanceAfterShip(shipped, converging)).toEqual({
      advance: false,
      reason: "converging",
    });
    const stopped = decideShipLane({ ...ready, ci: "red", ciFixAttempts: 1 });
    expect(decideAdvanceAfterShip(stopped, false).advance).toBe(false);
  });
});

describe("ship converge poll helpers", () => {
  it("defaults the poll window to 20 minutes", () => {
    expect(DEFAULT_SHIP_CONVERGE_WINDOW_MS).toBe(20 * 60 * 1000);
    expect(shipConvergeAttempts()).toBe(
      Math.ceil(DEFAULT_SHIP_CONVERGE_WINDOW_MS / DEFAULT_SHIP_CONVERGE_DELAY_MS),
    );
  });

  it("polls npm latest until match and times out when stale", async () => {
    let n = 0;
    await expect(
      waitForShipNpmLatest({
        expectedVersion: "5.14.2",
        fetchLatest: async () => {
          n += 1;
          return n < 3 ? "5.14.1" : "5.14.2";
        },
        windowMs: 45,
        delayMs: 15,
        sleep: async () => {},
      }),
    ).resolves.toEqual({ ok: true, value: "5.14.2" });
    expect(n).toBe(3);

    await expect(
      waitForShipNpmLatest({
        expectedVersion: "5.14.2",
        fetchLatest: async () => "5.14.1",
        windowMs: 30,
        delayMs: 15,
        sleep: async () => {},
      }),
    ).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("reuses waitForPublicLatest for Release Latest converge", () => {
    let n = 0;
    expect(
      waitForShipReleaseLatest({
        expectedVersion: "5.14.2",
        fetchLatest: () => {
          n += 1;
          if (n < 2) throw new Error("not yet");
          return "v5.14.2";
        },
        waitForPublicLatest,
        windowMs: 30,
        delayMs: 15,
        sleep: () => {},
      }),
    ).toEqual({ ok: true, value: "v5.14.2" });
    expect(n).toBe(2);

    expect(
      waitForShipReleaseLatest({
        expectedVersion: "5.14.2",
        fetchLatest: () => "v5.14.1",
        waitForPublicLatest,
        windowMs: 30,
        delayMs: 15,
        sleep: () => {},
      }),
    ).toEqual({ ok: false, reason: "timeout" });
  });

  it("polls a generic row match for landing HTML lag", async () => {
    const matches = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(
      waitForShipRowMatch({
        matches,
        windowMs: 30,
        delayMs: 15,
        sleep: async () => {},
      }),
    ).resolves.toEqual({ ok: true });
    expect(matches).toHaveBeenCalledTimes(2);
  });
});
