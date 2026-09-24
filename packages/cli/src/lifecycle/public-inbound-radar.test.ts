import { describe, expect, it } from "vitest";
import {
  type GhRunner,
  PUBLIC_INBOUND_REPO,
  type PublicInboundResult,
  checkPublicInbound,
  classifyInbound,
  isDependabotAuthor,
  shouldEmitPublicInboundNudge,
} from "./public-inbound-radar.js";

const FIXED = new Date("2026-09-24T16:00:00.000Z");

describe("public-inbound-radar helpers", () => {
  it("detects Dependabot authors", () => {
    expect(isDependabotAuthor("dependabot[bot]")).toBe(true);
    expect(isDependabotAuthor("Dependabot")).toBe(true);
    expect(isDependabotAuthor("renovate[bot]")).toBe(true);
    expect(isDependabotAuthor("alice")).toBe(false);
  });

  it("classifies issue / human-pr / dependabot", () => {
    expect(classifyInbound("issue", "alice")).toBe("issue");
    expect(classifyInbound("pull_request", "alice")).toBe("human-pr");
    expect(classifyInbound("pull_request", "dependabot[bot]")).toBe("dependabot");
  });

  it("emits nudge only when ok with open items", () => {
    const empty: PublicInboundResult = {
      status: "ok",
      repo: PUBLIC_INBOUND_REPO,
      checkedAt: FIXED.toISOString(),
      factory: true,
      items: [],
      summary: { issues: 0, humanPullRequests: 0, dependabotPullRequests: 0, total: 0 },
      message: "none",
      mutateRecommended: false,
    };
    expect(shouldEmitPublicInboundNudge(empty)).toBe(false);
    expect(
      shouldEmitPublicInboundNudge({
        ...empty,
        summary: { issues: 1, humanPullRequests: 0, dependabotPullRequests: 0, total: 1 },
      }),
    ).toBe(true);
    expect(shouldEmitPublicInboundNudge({ ...empty, status: "skipped-disabled" })).toBe(false);
  });
});

describe("checkPublicInbound", () => {
  it("skips non-factory checkouts", async () => {
    const result = await checkPublicInbound("/tmp", {
      isFactory: async () => false,
      now: () => FIXED,
      runGh: async () => {
        throw new Error("should not run gh");
      },
    });
    expect(result.status).toBe("skipped-non-factory");
    expect(result.factory).toBe(false);
    expect(result.mutateRecommended).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("skips when offline", async () => {
    const result = await checkPublicInbound("/tmp", {
      isFactory: async () => true,
      offline: true,
      now: () => FIXED,
    });
    expect(result.status).toBe("skipped-offline");
    expect(result.factory).toBe(true);
  });

  it("skips when gh is missing", async () => {
    const runGh: GhRunner = async () => {
      throw new Error("gh not found");
    };
    const result = await checkPublicInbound("/tmp", {
      isFactory: async () => true,
      runGh,
      now: () => FIXED,
    });
    expect(result.status).toBe("skipped-gh-missing");
  });

  it("skips when respectPrefs and disabled", async () => {
    const result = await checkPublicInbound("/tmp", {
      isFactory: async () => true,
      respectPrefs: true,
      now: () => FIXED,
      runGh: async () => {
        throw new Error("should not run gh");
      },
    });
    expect(result.status).toBe("skipped-disabled");
  });

  it("lists issues and pull requests as JSON-shaped result", async () => {
    const runGh: GhRunner = async (args) => {
      if (args[0] === "--version") return "gh version 2.0.0";
      if (args[0] === "issue") {
        return JSON.stringify([
          {
            number: 42,
            title: "Docs typo",
            author: { login: "carol" },
            updatedAt: "2026-09-20T00:00:00Z",
            labels: [{ name: "docs" }],
            url: "https://github.com/agent-kit-startup/agent-kit/issues/42",
          },
        ]);
      }
      if (args[0] === "pr") {
        return JSON.stringify([
          {
            number: 80,
            title: "Bump actions/checkout",
            author: { login: "dependabot[bot]" },
            updatedAt: "2026-09-22T00:00:00Z",
            labels: ["dependencies"],
            url: "https://github.com/agent-kit-startup/agent-kit/pull/80",
          },
          {
            number: 55,
            title: "Add landing CTA",
            author: { login: "dave" },
            updatedAt: "2026-09-21T00:00:00Z",
            labels: [],
            url: "https://github.com/agent-kit-startup/agent-kit/pull/55",
          },
        ]);
      }
      throw new Error(`unexpected gh args: ${args.join(" ")}`);
    };

    const result = await checkPublicInbound("/tmp", {
      isFactory: async () => true,
      runGh,
      now: () => FIXED,
    });

    expect(result.status).toBe("ok");
    expect(result.repo).toBe(PUBLIC_INBOUND_REPO);
    expect(result.checkedAt).toBe(FIXED.toISOString());
    expect(result.summary).toEqual({
      issues: 1,
      humanPullRequests: 1,
      dependabotPullRequests: 1,
      total: 3,
    });
    expect(result.items.map((i) => i.class).sort()).toEqual(["dependabot", "human-pr", "issue"]);
    expect(result.items.find((i) => i.number === 42)?.cite).toBe("agent-kit-startup/agent-kit#42");
    expect(result.mutateRecommended).toBe(false);
    // Dependabot collapses to one class; callers must not enqueue one plan per PR.
    expect(result.items.filter((i) => i.class === "dependabot")).toHaveLength(1);
  });

  it("fail-opens on network errors", async () => {
    const runGh: GhRunner = async (args) => {
      if (args[0] === "--version") return "gh version 2.0.0";
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    };
    const result = await checkPublicInbound("/tmp", {
      isFactory: async () => true,
      runGh,
      now: () => FIXED,
    });
    expect(result.status).toBe("skipped-offline");
  });
});
