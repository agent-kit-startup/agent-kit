// Ship lane collector (dashboard/lib/ship-lane.mjs) and its wiring in
// dashboard-data.mjs (snapshot 1.8.0; staging vs main comparison 1.11.0). Pure parsing/row logic is tested
// against fixture `gh api graphql` output; the subprocess cases run the real
// data script with a `gh` shim on PATH (fixture, failed call, budget, cache).
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildShipLaneRows,
  classifyGhFailure,
  classifyReleasePending,
  isFactorySlug,
  parseForgeRemote,
  readCachedShipLaneRemote,
  SHIP_LANE_CACHE_ENV,
  SHIP_LANE_CACHE_TTL_MS,
  safeNpmName,
  safeTagName,
  shipLaneCacheJsonFromSnapshot,
  shipLaneCompare,
  shipLaneGhArgs,
  trimShipLaneGraphql,
} from "../../../../dashboard/lib/ship-lane.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardDataScript = resolve(repoRoot, "dashboard/dashboard-data.mjs");

const checkRun = (name: string, conclusion: string | null, status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
});

function pr(
  number: number,
  head: string,
  base: string,
  checks: unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    number,
    title: `PR ${number}`,
    isDraft: false,
    baseRefName: base,
    headRefName: head,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: checks } } } }],
    },
    ...extra,
  };
}

const commit = (oid: string, headline: string, parents = 1) => ({
  oid: oid.padEnd(40, "0"),
  messageHeadline: headline,
  parents: { totalCount: parents },
});

/** The 2026-11-07 staging: the #1422 sync merge-back and a docs(memory) commit. */
const MERGE_BACK_AND_DOCS = [
  commit(
    "fb4982e7",
    "Merge pull request #1422 from agent-kit-startup/chore/sync-staging-6.14.0",
    2,
  ),
  commit("9dcf435a", "docs(memory): record the 76px labelled Colony rail in the shell ADR (#1423)"),
];

/**
 * Shape of `gh api graphql` stdout for SHIP_LANE_QUERY (trimmed from a live
 * 2026-10-23 read; compare and promoted from a live 2026-11-08 read).
 */
function graphqlFixture(
  tagJobs: unknown[] = [],
  opts: { compare?: unknown; promoted?: unknown[] } = {},
) {
  return {
    data: {
      repo: {
        base: {
          compare:
            "compare" in opts
              ? opts.compare
              : { aheadBy: 0, behindBy: 0, commits: { totalCount: 0, nodes: [] } },
        },
        promoted: { nodes: opts.promoted ?? [] },
        pullRequests: {
          totalCount: 3,
          nodes: [
            pr(12, "chore/close-release-1.1.0", "staging", [
              checkRun("build", "SUCCESS"),
              checkRun("signature-scan", "SUCCESS"),
            ]),
            pr(11, "feat/b", "feat/a", [checkRun("build", null, "IN_PROGRESS")], {
              title: `x${"y".repeat(400)}`,
            }),
            pr(
              10,
              "feat/a",
              "staging",
              [checkRun("build", "FAILURE"), checkRun("signature-scan", "FAILURE")],
              { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" },
            ),
          ],
        },
        latestRelease: null,
        tag: {
          name: "v1.0.0",
          target: {
            __typename: "Tag",
            target: {
              oid: "a".repeat(40),
              committedDate: "2026-10-23T11:00:00Z",
              checkSuites: {
                nodes: [
                  {
                    workflowRun: { databaseId: 1, event: "push", workflow: { name: "CI" } },
                    checkRuns: {
                      nodes: [checkRun("build", "SUCCESS"), checkRun("publish-npm", "SKIPPED")],
                    },
                  },
                  {
                    workflowRun: { databaseId: 77, event: "push", workflow: { name: "CI" } },
                    checkRuns: {
                      nodes: tagJobs.length
                        ? tagJobs
                        : [checkRun("build", "SUCCESS"), checkRun("publish-npm", "SUCCESS")],
                    },
                  },
                  {
                    workflowRun: { databaseId: 5, event: "pull_request", workflow: { name: "CI" } },
                    checkRuns: { nodes: [checkRun("build", "FAILURE")] },
                  },
                ],
              },
            },
          },
        },
      },
      pub: {
        latestRelease: { tagName: "v1.0.0", publishedAt: "2026-10-23T12:00:00Z" },
        pullRequests: {
          nodes: [
            {
              number: 3,
              title: "chore: sync private v1.0.0 (abc)",
              state: "MERGED",
              mergedAt: "2026-10-23T12:00:00Z",
            },
          ],
        },
      },
    },
  };
}

const META = {
  repo: "acme/agent-kit-dev",
  tag: "v1.0.0",
  publicRepo: "acme/agent-kit",
  fetchedAt: "2026-10-23T12:00:00.000Z",
};

const LOCAL_SHIPPED = {
  latestTag: "v1.0.0",
  version: "1.0.0",
  mainRef: "origin/main",
  stagingAheadOfMain: 0,
  mainInStaging: true,
  tagOnMain: true,
};

function rowsById(rows: Array<{ id: string }>) {
  return Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, any>;
}

describe("parseForgeRemote", () => {
  it("reads ssh, scp and https GitHub remotes and flags GitLab hosts", () => {
    expect(parseForgeRemote("git@github.com:acme/app.git")).toMatchObject({
      provider: "github",
      slug: "acme/app",
    });
    expect(parseForgeRemote("https://github.com/acme/app")).toMatchObject({ slug: "acme/app" });
    expect(parseForgeRemote("ssh://git@github.com:22/acme/app.git")).toMatchObject({
      slug: "acme/app",
    });
    expect(parseForgeRemote("git@gitlab.com:group/sub/app.git")).toMatchObject({
      provider: "gitlab",
      owner: "group/sub",
      name: "app",
    });
  });

  it("rejects empty, slug-less and shell-shaped values", () => {
    expect(parseForgeRemote(null)).toBeNull();
    expect(parseForgeRemote("")).toBeNull();
    expect(parseForgeRemote("https://github.com/acme")).toBeNull();
    expect(parseForgeRemote("git@github.com:acme/$(id).git")).toBeNull();
  });

  it("treats only an agent-kit-dev origin as the factory lane", () => {
    expect(isFactorySlug("agent-kit-startup/agent-kit-dev")).toBe(true);
    expect(isFactorySlug("acme/app")).toBe(false);
  });
});

describe("command-safe names (security pass p4)", () => {
  it("keeps plain v* tags and drops tags with shell metacharacters", () => {
    expect(safeTagName("v6.8.0")).toBe("v6.8.0");
    expect(safeTagName("v1.0.0-rc.1+build.5")).toBe("v1.0.0-rc.1+build.5");
    for (const bad of [
      "v1;id",
      "v2$(id)",
      "v3`id`",
      "v4|sh",
      "v5&x",
      "v6'x",
      "release-1",
      "",
      null,
    ]) {
      expect(safeTagName(bad), String(bad)).toBeNull();
    }
  });

  it("keeps valid npm names and drops anything a shell would read twice", () => {
    expect(safeNpmName("@dadado/agent-kit-cli")).toBe("@dadado/agent-kit-cli");
    expect(safeNpmName("left-pad")).toBe("left-pad");
    for (const bad of ["x;id", "$(id)", "@a/b c", "Upper", "", undefined]) {
      expect(safeNpmName(bad), String(bad)).toBeNull();
    }
  });
});

describe("shipLaneGhArgs", () => {
  it("passes values as -F fields (no shell) and disables the public half outside the factory", () => {
    const args = shipLaneGhArgs({ owner: "acme", name: "app", tag: null, publicRepo: null });
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(args).toContain("tag=refs/tags/__no_tag__");
    expect(args).toContain("withPublic=false");
    expect(args).toContain("main=main");
    expect(args).toContain("mainRef=refs/heads/main");
  });

  it("compares against master when that is the production branch, and nothing else", () => {
    const master = shipLaneGhArgs({
      owner: "a",
      name: "b",
      tag: null,
      publicRepo: null,
      main: "master",
    });
    expect(master).toContain("mainRef=refs/heads/master");
    const odd = shipLaneGhArgs({ owner: "a", name: "b", tag: null, publicRepo: null, main: "x;y" });
    expect(odd).toContain("main=main");
  });
});

describe("trimShipLaneGraphql", () => {
  const remote = trimShipLaneGraphql(graphqlFixture(), META);

  it("returns null without an origin repo object (errors-only or malformed output)", () => {
    expect(trimShipLaneGraphql({ errors: [{ message: "x" }] }, META)).toBeNull();
    expect(trimShipLaneGraphql(null, META)).toBeNull();
  });

  it("trims open PRs: stacking, mergeable state, failing checks and signature-scan", () => {
    expect(remote?.prsTotal).toBe(3);
    const byNumber = Object.fromEntries((remote?.prs ?? []).map((p: any) => [p.number, p]));
    expect(byNumber[11].stackedOn).toBe(10);
    expect(byNumber[10].stackedOn).toBeNull();
    expect(byNumber[10]).toMatchObject({ mergeable: "conflicting", mergeState: "dirty" });
    expect(byNumber[10].checks).toMatchObject({
      failing: ["build", "signature-scan"],
      signatureScan: "failure",
    });
    expect(byNumber[11].checks).toMatchObject({ pending: 1, signatureScan: "missing" });
  });

  it("caps untrusted forge text", () => {
    const long = remote?.prs.find((p: any) => p.number === 11);
    expect(long.title.length).toBeLessThanOrEqual(121);
  });

  it("picks the tag's own push run (most non-skipped jobs), not the main push or a PR run", () => {
    expect(remote?.tagCi).toMatchObject({ runId: 77, workflow: "CI" });
    expect(remote?.tagCi?.jobs.map((j: any) => j.state)).toEqual(["success", "success"]);
  });

  it("reads the staging vs main comparison, the tag commit and the latest merged promote", () => {
    const r = trimShipLaneGraphql(
      graphqlFixture([], {
        compare: {
          aheadBy: 2,
          behindBy: 1,
          commits: { totalCount: 2, nodes: MERGE_BACK_AND_DOCS },
        },
        promoted: [
          {
            number: 1400,
            title: "older",
            mergedAt: "2026-11-01T10:00:00Z",
            mergeCommit: { oid: "b".repeat(40) },
          },
          {
            number: 1421,
            title: "promote",
            mergedAt: "2026-11-07T17:24:41Z",
            mergeCommit: { oid: "c".repeat(40) },
          },
        ],
      }),
      META,
    );
    expect(r?.compare).toMatchObject({ ahead: 2, behind: 1, total: 2 });
    expect(r?.compare?.commits[0]).toMatchObject({ parents: 2 });
    expect(r?.promoted).toMatchObject({ number: 1421, mergeOid: "c".repeat(40) });
    expect(r?.tagCommit).toEqual({ oid: "a".repeat(40), committedDate: "2026-10-23T11:00:00Z" });
    // A missing staging branch on the forge: compare is null, not an error.
    expect(trimShipLaneGraphql(graphqlFixture([], { compare: null }), META)?.compare).toBeNull();
  });

  it("reads the public release and sync PRs", () => {
    expect(remote?.public?.release?.tag).toBe("v1.0.0");
    expect(remote?.public?.syncPrs[0]).toMatchObject({ number: 3, state: "merged" });
  });
});

describe("buildShipLaneRows", () => {
  it("factory lane, shipped release: every Done row is green", () => {
    const remote = trimShipLaneGraphql(graphqlFixture(), META);
    remote.npm = { name: "@acme/cli", version: "1.0.0" };
    remote.prs = [];
    const rows = buildShipLaneRows({
      lane: "factory",
      repo: META.repo,
      publicRepo: META.publicRepo,
      local: LOCAL_SHIPPED,
      remote,
      compare: shipLaneCompare({ remote, local: null }),
    });
    expect(rows.map((r: any) => r.id)).toEqual([
      "release-close",
      "staging-main",
      "tag",
      "tag-ci",
      "staging-sync",
      "npm",
      "public-sync",
      "public-release",
    ]);
    expect(rows.every((r: any) => r.state === "green")).toBe(true);
  });

  it("a red tag CI job copies a rerun of the failed jobs; a close PR shows its checks", () => {
    const remote = trimShipLaneGraphql(
      graphqlFixture([checkRun("build", "SUCCESS"), checkRun("sync-public", "FAILURE")], {
        compare: {
          aheadBy: 2,
          behindBy: 0,
          commits: { totalCount: 2, nodes: [commit("1", "feat: a"), commit("2", "fix: b")] },
        },
      }),
      META,
    );
    const rows = rowsById(
      buildShipLaneRows({
        lane: "factory",
        repo: META.repo,
        publicRepo: META.publicRepo,
        local: { ...LOCAL_SHIPPED, stagingAheadOfMain: 2 },
        remote,
        compare: shipLaneCompare({ remote, local: null }),
      }),
    );
    expect(rows["tag-ci"]).toMatchObject({
      state: "red",
      next: { text: "gh run rerun 77 --failed", destination: "terminal" },
    });
    expect(rows["release-close"]).toMatchObject({
      state: "pending",
      next: { text: "gh pr checks 12" },
    });
    expect(rows["staging-main"]).toMatchObject({
      state: "pending",
      next: { text: "/kit-prod", destination: "agent chat input" },
    });
  });

  it("an unavailable forge half degrades to unknown rows with the skip note, never throws", () => {
    const rows = rowsById(
      buildShipLaneRows({
        lane: "factory",
        repo: META.repo,
        publicRepo: META.publicRepo,
        local: LOCAL_SHIPPED,
        remote: { available: false, reason: "gh-auth" },
      }),
    );
    expect(rows["tag-ci"]).toMatchObject({
      state: "unknown",
      detail: "skipped: gh not authenticated",
    });
    expect(rows["public-release"].state).toBe("unknown");
    expect(rows.tag.state).toBe("green");
    expect(rows["staging-sync"].state).toBe("green");
  });

  it("consumer lane: no public rows, /git-prod as the slash, main missing staging is red", () => {
    const rows = buildShipLaneRows({
      lane: "consumer",
      repo: "acme/app",
      publicRepo: null,
      local: { ...LOCAL_SHIPPED, version: "1.1.0", mainInStaging: false },
      remote: { available: false, reason: "budget" },
    });
    const byId = rowsById(rows);
    expect(byId["public-sync"]).toBeUndefined();
    expect(byId.tag).toMatchObject({ state: "pending", next: { text: "/git-prod" } });
    expect(byId["staging-sync"].state).toBe("red");
  });
});

describe("classifyReleasePending", () => {
  const c = (headline: string, parents = 1, paths: string[] | null = null) => ({
    oid: "x",
    headline,
    parents,
    paths,
  });

  it("a merge-back and a docs(memory) commit leave nothing to ship", () => {
    const r = classifyReleasePending({
      commits: MERGE_BACK_AND_DOCS.map((n) => c(n.messageHeadline, n.parents.totalCount)),
      total: 2,
    });
    expect(r).toMatchObject({ pending: false, release: 0, merge: 1, docs: 1, sync: 0 });
  });

  it("a feat commit makes a release pending", () => {
    const r = classifyReleasePending({ commits: [c("docs: x"), c("feat(cli): y")], total: 2 });
    expect(r).toMatchObject({ pending: true, release: 1, docs: 1 });
  });

  it("a squashed staging sync is not release-worthy", () => {
    expect(
      classifyReleasePending({ commits: [c("chore: sync staging with main after v6.14.0")] }).sync,
    ).toBe(1);
    expect(classifyReleasePending({ commits: [c("chore/sync-staging-6.14.0 (#9)")] }).sync).toBe(1);
  });

  it("known paths decide over the commit type", () => {
    const r = classifyReleasePending({
      commits: [
        c("docs: describe the engine split", 1, ["docs/x.md", "packages/game/src/a.ts"]),
        c("feat: memory only", 1, [".cursor/memory/decisions/a.md", ".cursor/HANDOFF.md"]),
        c("chore: notes", 1, ["CHANGELOG.md", "dogfood/README.md", ".cursor/plans/p.plan.md"]),
      ],
    });
    expect(r).toMatchObject({ release: 1, docs: 2, pending: true });
    expect(
      classifyReleasePending({ commits: [c("docs(commands): x", 1, [".cursor/commands/a.md"])] })
        .pending,
    ).toBe(true);
  });

  it("a truncated page never reads as nothing to ship", () => {
    const r = classifyReleasePending({ commits: [c("docs: a")], total: 140 });
    expect(r).toMatchObject({ pending: true, truncated: true, examined: 1, total: 140 });
  });
});

describe("buildShipLaneRows: staging vs main from the comparison", () => {
  const rows = (
    remote: unknown,
    compare: ReturnType<typeof shipLaneCompare> | null,
    local: Record<string, unknown> = {},
  ) =>
    rowsById(
      buildShipLaneRows({
        lane: "factory",
        repo: META.repo,
        publicRepo: META.publicRepo,
        local: { ...LOCAL_SHIPPED, ...local },
        remote,
        compare,
      }),
    );
  const forge = (opts: Parameters<typeof graphqlFixture>[1]) => {
    const remote = trimShipLaneGraphql(graphqlFixture([], opts), META);
    remote.prs = [];
    return remote;
  };

  it("merge-back + docs commit: nothing to ship, no release close and no promote asked for", () => {
    const remote = forge({
      compare: { aheadBy: 2, behindBy: 0, commits: { totalCount: 2, nodes: MERGE_BACK_AND_DOCS } },
    });
    const r = rows(remote, shipLaneCompare({ remote, local: null }), { stagingAheadOfMain: 2 });
    expect(r["release-close"]).toMatchObject({ state: "green", next: null });
    expect(r["release-close"].detail).toMatch(/staging \+2 \(nothing to ship\)/);
    expect(r["staging-main"]).toMatchObject({
      state: "green",
      detail: "staging +2 (nothing to ship)",
    });
    expect(r["staging-sync"].state).toBe("green");
  });

  it("a feat commit: release pending on both rows", () => {
    const remote = forge({
      compare: {
        aheadBy: 3,
        behindBy: 0,
        commits: { totalCount: 3, nodes: [...MERGE_BACK_AND_DOCS, commit("3", "feat(cli): z")] },
      },
    });
    const r = rows(remote, shipLaneCompare({ remote, local: null }));
    expect(r["release-close"]).toMatchObject({ state: "pending", next: { text: "/kit-prod" } });
    expect(r["release-close"].detail).toMatch(/^release pending: 1 commit\(s\)/);
    expect(r["staging-main"]).toMatchObject({
      state: "pending",
      detail: "release pending: 1 commit(s), no open PR",
    });
  });

  it("a just-merged promote PR shows as merged, waiting on the tag and the sync", () => {
    const remote = forge({
      compare: { aheadBy: 0, behindBy: 1, commits: { totalCount: 0, nodes: [] } },
      promoted: [
        {
          number: 1421,
          title: "promote",
          mergedAt: "2026-11-07T17:24:41Z",
          mergeCommit: { oid: "c".repeat(40) },
        },
      ],
    });
    // Local refs are stale (never fetched): they still say staging is 2 ahead.
    const r = rows(remote, shipLaneCompare({ remote, local: null }), {
      version: "1.1.0",
      stagingAheadOfMain: 2,
      mainInStaging: true,
    });
    expect(r["staging-main"]).toMatchObject({
      state: "green",
      detail: "#1421 merged; waiting on the tag and the staging sync",
    });
    expect(r["staging-main"].detail).not.toMatch(/no open PR/);
    expect(r["staging-sync"]).toMatchObject({ state: "red" });
    expect(r["staging-sync"].detail).toMatch(/1 commit\(s\) staging lacks/);
  });

  it("a promote whose tag and sync are done falls back to the comparison", () => {
    const remote = forge({
      promoted: [
        {
          number: 1,
          title: "p",
          mergedAt: "2026-10-23T10:00:00Z",
          mergeCommit: { oid: "a".repeat(40) },
        },
      ],
    });
    const r = rows(remote, shipLaneCompare({ remote, local: null }));
    expect(r["staging-main"]).toMatchObject({
      state: "green",
      detail: "main has everything on staging",
    });
  });

  it("forge down: the local refs decide, labelled local", () => {
    const local = {
      ahead: 2,
      behind: 0,
      total: 2,
      commits: [
        { oid: "1", headline: "feat: a", parents: 1, paths: ["src/a.ts"] },
        { oid: "2", headline: "docs: b", parents: 1, paths: ["docs/b.md"] },
      ],
    };
    const remote = { available: false, reason: "timeout" };
    const compare = shipLaneCompare({ remote, local });
    expect(compare).toMatchObject({ source: "local", fetchedAt: null, release: 1, docs: 1 });
    const r = rows(remote, compare);
    expect(r["staging-main"].state).toBe("pending");
    expect(r["staging-main"].detail).toMatch(/local refs, not fetched/);
    expect(r["staging-main"].detail).toMatch(/skipped: gh timed out/);
    expect(r["release-close"].detail).toMatch(/local refs, not fetched/);
  });

  it("a forge half without a comparison (no staging on the forge) uses the local refs", () => {
    const remote = forge({ compare: null });
    expect(shipLaneCompare({ remote, local: null }).source).toBeNull();
    expect(rows(remote, shipLaneCompare({ remote, local: null }))["staging-main"].state).toBe(
      "unknown",
    );
    expect(
      shipLaneCompare({ remote, local: { ahead: 0, behind: 0, total: 0, commits: [] } }).source,
    ).toBe("local");
  });

  it("forge commit paths from the local object store refine the type", () => {
    const remote = forge({
      compare: {
        aheadBy: 1,
        behindBy: 0,
        commits: { totalCount: 1, nodes: [commit("d", "docs: engine split")] },
      },
    });
    const paths = new Map([["d".padEnd(40, "0"), ["packages/game/src/a.ts"]]]);
    expect(shipLaneCompare({ remote, local: null }).pending).toBe(false);
    expect(shipLaneCompare({ remote, local: null, paths })).toMatchObject({
      source: "forge",
      pending: true,
      fetchedAt: META.fetchedAt,
    });
  });
});

describe("ship lane cache", () => {
  const NOW = Date.parse(META.fetchedAt);
  const remote = trimShipLaneGraphql(graphqlFixture(), META);
  const key = { repo: META.repo, tag: META.tag };

  it("reuses a fresh result for the same repo and tag only", () => {
    const raw = JSON.stringify(remote);
    expect(readCachedShipLaneRemote(raw, NOW + 5_000, key)).toMatchObject({ available: true });
    expect(readCachedShipLaneRemote(raw, NOW + SHIP_LANE_CACHE_TTL_MS, key)).toBeNull();
    expect(readCachedShipLaneRemote(raw, NOW, { ...key, tag: "v1.0.1" })).toBeNull();
    expect(readCachedShipLaneRemote(raw, NOW, { ...key, repo: "acme/other" })).toBeNull();
    expect(readCachedShipLaneRemote("{nope", NOW, key)).toBeNull();
  });

  it("hands back only gh-attempted results (a budget miss has no fetchedAt)", () => {
    expect(shipLaneCacheJsonFromSnapshot({ shipLane: { remote } })).toBeTypeOf("string");
    expect(
      shipLaneCacheJsonFromSnapshot({
        shipLane: { remote: { available: false, reason: "budget" } },
      }),
    ).toBeNull();
  });
});

describe("classifyGhFailure", () => {
  it("names missing, timed-out and unauthenticated gh", () => {
    expect(classifyGhFailure({ code: "ENOENT" })).toBe("gh-missing");
    expect(classifyGhFailure({ killed: true })).toBe("timeout");
    expect(
      classifyGhFailure({ code: 4 }, "To get started with GitHub CLI, please run:  gh auth login"),
    ).toBe("gh-auth");
    expect(classifyGhFailure({ code: 1 }, "HTTP 502")).toBe("call-failed");
  });
});

describe("dashboard-data.mjs: shipLane collector", { timeout: 60_000 }, () => {
  /** Scratch consumer repo with origin/main, origin/staging and a v1.0.0 tag; gh is a shim. */
  function runWithShim(opts: {
    ghScript: string;
    budgetMs?: string;
    cache?: string;
    tag?: string;
    /** origin/staging gets a feature branch merge (feat), a docs-only commit and a docs-typed commit. */
    stagingCommits?: boolean;
  }) {
    const work = mkdtempSync(join(tmpdir(), "ak-ship-lane-"));
    try {
      const bin = join(work, "bin");
      const repo = join(work, "repo");
      const home = join(work, "home");
      mkdirSync(bin);
      mkdirSync(repo);
      mkdirSync(home);
      const marker = join(work, "gh-called");
      const fixture = join(work, "fixture.json");
      writeFileSync(fixture, JSON.stringify(graphqlFixture()));
      writeFileSync(
        join(bin, "gh"),
        `#!/bin/sh\ncase "$1" in api) touch "${marker}" ;; esac\n${opts.ghScript.replace("FIXTURE", fixture)}\n`,
      );
      chmodSync(join(bin, "gh"), 0o755);
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
      git("init", "-q");
      git("config", "user.email", "ship-lane-test@example.com");
      git("config", "user.name", "Ship Lane Test");
      git("config", "commit.gpgsign", "false");
      git("config", "tag.gpgsign", "false");
      writeFileSync(
        join(repo, "package.json"),
        '{"name":"app","version":"1.0.0","private":true}\n',
      );
      git("add", "package.json");
      git("commit", "-q", "-m", "init");
      git("remote", "add", "origin", "git@github.com:acme/app.git");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("tag", opts.tag ?? "v1.0.0");
      if (opts.stagingCommits) {
        git("checkout", "-q", "-b", "work");
        mkdirSync(join(repo, "src"));
        writeFileSync(join(repo, "src", "a.js"), "export const a = 1;\n");
        git("add", "src/a.js");
        git("commit", "-q", "-m", "feat: a");
        git("checkout", "-q", "-");
        git("merge", "-q", "--no-ff", "-m", "Merge branch 'work'", "work");
        mkdirSync(join(repo, "docs"));
        writeFileSync(join(repo, "docs", "a.md"), "# a\n");
        git("add", "docs/a.md");
        git("commit", "-q", "-m", "chore: notes");
        git("commit", "-q", "--allow-empty", "-m", "docs: empty");
        git("update-ref", "refs/remotes/origin/staging", "HEAD");
      } else {
        git("update-ref", "refs/remotes/origin/staging", "HEAD");
      }
      const out = execFileSync("node", [dashboardDataScript], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: home,
          MISSION_CONTROL_REPO_ROOT: repo,
          HOST: "127.0.0.1",
          MISSION_CONTROL_TOKEN: "",
          AGENT_KIT_DASHBOARD_DATA_BUDGET_MS: opts.budgetMs ?? "60000",
          [SHIP_LANE_CACHE_ENV]: opts.cache ?? "",
        },
      });
      const snap = JSON.parse(out) as { shipLane: any };
      return { shipLane: snap.shipLane, ghCalled: existsSync(marker) };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  it("parses fixture gh output into rows for the latest tag", () => {
    const { shipLane, ghCalled } = runWithShim({
      ghScript: 'case "$1" in api) cat "FIXTURE" ;; *) echo "[]" ;; esac',
    });
    expect(ghCalled).toBe(true);
    expect(shipLane.compare).toMatchObject({
      source: "forge",
      ahead: 0,
      behind: 0,
      pending: false,
    });
    expect(shipLane).toMatchObject({ lane: "consumer", repo: "acme/app", publicRepo: null });
    expect(shipLane.local).toMatchObject({
      latestTag: "v1.0.0",
      version: "1.0.0",
      mainInStaging: true,
    });
    expect(shipLane.remote).toMatchObject({ available: true, tag: "v1.0.0" });
    const rows = rowsById(shipLane.rows);
    expect(rows["tag-ci"].state).toBe("green");
    expect(rows.tag.state).toBe("green");
    expect(rows.npm).toBeUndefined();
  });

  it("offline / failed gh: remote unavailable with a reason, rows unknown, snapshot intact", () => {
    const { shipLane } = runWithShim({ ghScript: 'echo "HTTP 502" >&2; exit 1' });
    expect(shipLane.remote).toMatchObject({ available: false, reason: "call-failed" });
    expect(typeof shipLane.remote.fetchedAt).toBe("string");
    expect(shipLane.note).toMatch(/skipped/);
    expect(rowsById(shipLane.rows)["tag-ci"].state).toBe("unknown");
    expect(shipLane.compare).toMatchObject({ source: "local", ahead: 0, behind: 0 });
  });

  it("forge down with staging ahead locally: a merge and a docs commit stay off, a feat counts", () => {
    const { shipLane } = runWithShim({
      ghScript: 'echo "HTTP 502" >&2; exit 1',
      stagingCommits: true,
    });
    expect(shipLane.compare).toMatchObject({
      source: "local",
      ahead: 4,
      behind: 0,
      merge: 1,
      docs: 2,
      release: 1,
      pending: true,
    });
    const rows = rowsById(shipLane.rows);
    expect(rows["staging-main"]).toMatchObject({ state: "pending" });
    expect(rows["staging-main"].detail).toMatch(/release pending: 1 commit\(s\).*local refs/);
  });

  it("a tag with shell metacharacters never reaches gh or a copyable command", () => {
    const { shipLane } = runWithShim({
      ghScript: 'case "$1" in api) cat "FIXTURE" ;; *) echo "[]" ;; esac',
      tag: "v2$(id)",
    });
    expect(shipLane.local).toMatchObject({ latestTag: null, unsafeTag: true });
    const rows = rowsById(shipLane.rows);
    expect(rows.tag).toMatchObject({ state: "unknown", next: null });
    expect(JSON.stringify(shipLane.rows)).not.toContain("$(id)");
  });

  it("budget exhausted: gh is never attempted", () => {
    const { shipLane, ghCalled } = runWithShim({ ghScript: 'cat "FIXTURE"', budgetMs: "1" });
    expect(ghCalled).toBe(false);
    expect(shipLane.remote).toMatchObject({ available: false, reason: "budget" });
  });

  it("a fresh cached forge half skips gh", () => {
    const cached = {
      ...trimShipLaneGraphql(graphqlFixture(), {
        repo: "acme/app",
        tag: "v1.0.0",
        publicRepo: null,
        fetchedAt: new Date().toISOString(),
      }),
    };
    const { shipLane, ghCalled } = runWithShim({
      ghScript: 'case "$1" in api) echo "{}" ;; *) echo "[]" ;; esac',
      cache: JSON.stringify(cached),
    });
    expect(ghCalled).toBe(false);
    expect(shipLane.remote.fetchedAt).toBe(cached.fetchedAt);
  });
});
