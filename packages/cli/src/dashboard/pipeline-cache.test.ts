import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PIPELINE_CACHE_ENV,
  PIPELINE_CACHE_TTL_MS,
  pipelineCacheJsonFromSnapshot,
  readCachedPipeline,
} from "../../../../dashboard/lib/pipeline-cache.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardDataScript = resolve(repoRoot, "dashboard/dashboard-data.mjs");

const NOW = Date.parse("2026-09-27T05:00:00.000Z");
function pipelineAt(ageMs: number) {
  return {
    available: true,
    runs: [{ workflow: "CI", status: "completed", conclusion: "success" }],
    fetchedAt: new Date(NOW - ageMs).toISOString(),
  };
}

describe("readCachedPipeline", () => {
  it("returns a fresh cached pipeline and drops a stale one", () => {
    expect(readCachedPipeline(JSON.stringify(pipelineAt(5_000)), NOW)).toMatchObject({
      available: true,
    });
    expect(readCachedPipeline(JSON.stringify(pipelineAt(PIPELINE_CACHE_TTL_MS)), NOW)).toBeNull();
  });

  it("ignores empty, malformed, future and fetchedAt-less blobs", () => {
    expect(readCachedPipeline("", NOW)).toBeNull();
    expect(readCachedPipeline("{not json", NOW)).toBeNull();
    expect(readCachedPipeline(JSON.stringify(pipelineAt(-5_000)), NOW)).toBeNull();
    const budget = { available: false, runs: [], reason: "budget" };
    expect(readCachedPipeline(JSON.stringify(budget), NOW)).toBeNull();
  });

  it("only hands a gh-attempted pipeline back to the next snapshot", () => {
    expect(pipelineCacheJsonFromSnapshot({ devops: { pipeline: pipelineAt(0) } })).toBeTypeOf(
      "string",
    );
    const budget = { available: false, runs: [], reason: "budget" };
    expect(pipelineCacheJsonFromSnapshot({ devops: { pipeline: budget } })).toBeNull();
    expect(pipelineCacheJsonFromSnapshot(null)).toBeNull();
  });
});

describe("dashboard-data.mjs: gh run list cache", { timeout: 40_000 }, () => {
  /** Runs the data script with a `gh` shim that records each call to a marker file. */
  function runWithShim(prevPipeline: string) {
    const work = mkdtempSync(join(tmpdir(), "ak-pipeline-cache-"));
    try {
      const bin = join(work, "bin");
      const repo = join(work, "repo");
      const home = join(work, "home");
      mkdirSync(bin);
      mkdirSync(repo);
      mkdirSync(home);
      const marker = join(work, "gh-called");
      const shim = join(bin, "gh");
      writeFileSync(shim, `#!/bin/sh\ntouch "${marker}"\necho '[]'\n`);
      chmodSync(shim, 0o755);
      execFileSync("git", ["init", "-q"], { cwd: repo });
      const out = execFileSync("node", [dashboardDataScript], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: home,
          MISSION_CONTROL_REPO_ROOT: repo,
          // Leave room for the gh reserve (12s timeout + 400ms) so a stale cache can call it.
          AGENT_KIT_DASHBOARD_DATA_BUDGET_MS: "60000",
          [PIPELINE_CACHE_ENV]: prevPipeline,
        },
      });
      const snapshot = JSON.parse(out) as { devops: { pipeline: Record<string, unknown> } };
      return { pipeline: snapshot.devops.pipeline, ghCalled: existsSync(marker) };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  it("skips gh when the cached pipeline is fresh", () => {
    const fresh = { ...pipelineAt(0), fetchedAt: new Date().toISOString() };
    const { pipeline, ghCalled } = runWithShim(JSON.stringify(fresh));
    expect(ghCalled).toBe(false);
    expect(pipeline).toEqual(fresh);
  });

  it("calls gh when the cached pipeline is stale", () => {
    const stale = {
      ...pipelineAt(0),
      fetchedAt: new Date(Date.now() - PIPELINE_CACHE_TTL_MS - 1_000).toISOString(),
    };
    const { pipeline, ghCalled } = runWithShim(JSON.stringify(stale));
    expect(ghCalled).toBe(true);
    expect(pipeline).toMatchObject({ available: true, runs: [] });
    expect(pipeline.fetchedAt).not.toBe(stale.fetchedAt);
  });
});
