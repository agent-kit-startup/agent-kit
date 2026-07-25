import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  PERIODIC_REFRESH_MS,
  SNAPSHOT_REPO_SOURCE_RELS,
  SSE_SILENCE_MS,
  WATCH_DEBOUNCE_MS,
  createTrailingDebounce,
  isCoveredByWatchPaths,
  isSseSilent,
  resolveWatchPaths,
} from "../../../../dashboard/lib/live-refresh.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const serveSource = readFileSync(resolve(repoRoot, "dashboard/serve.mjs"), "utf8");
const dashboardHtml = readFileSync(resolve(repoRoot, "dashboard/dashboard.html"), "utf8");
const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");

describe("live-refresh: watch coverage", () => {
  it("covers every in-repo path that dashboard-data reads", () => {
    const root = "/repo";
    const watched = resolveWatchPaths(root, join(root, "dashboard"));
    for (const rel of SNAPSHOT_REPO_SOURCE_RELS) {
      const abs = join(root, rel);
      expect(isCoveredByWatchPaths(watched, abs), `unwatched source: ${rel}`).toBe(true);
    }
  });

  it("keeps package.json and dashboard-data.mjs on the watch list", () => {
    const watched = resolveWatchPaths("/repo", "/repo/dashboard");
    expect(watched).toContain(join("/repo", "package.json"));
    expect(watched).toContain(join("/repo", "dashboard", "dashboard-data.mjs"));
    expect(watched).toContain(join("/repo", ".cursor"));
  });

  it("wires resolveWatchPaths + periodic refresh into serve.mjs", () => {
    expect(serveSource).toContain("resolveWatchPaths");
    expect(serveSource).toContain("PERIODIC_REFRESH_MS");
    expect(serveSource).toContain("createTrailingDebounce");
    expect(serveSource).toContain("from './lib/live-refresh.mjs'");
    expect(serveSource).toMatch(/sseClients\.size === 0/);
    expect(serveSource).not.toMatch(/return inFlight;/);
  });

  it("documents readiness.json as a snapshot source (regression for prior gap)", () => {
    expect(dataSource).toContain("readiness.json");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/context/readiness.json");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/agents");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/skills");
  });
});

describe("live-refresh: trailing debounce", () => {
  it("fires once after the last call, not on intermediate bursts", () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const debounced = createTrailingDebounce(() => calls.push(Date.now()), WATCH_DEBOUNCE_MS);
    debounced();
    debounced();
    debounced();
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    debounced();
    vi.advanceTimersByTime(WATCH_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe("live-refresh: SSE silence + poll fallback", () => {
  it("detects an open stream with no recent data payloads", () => {
    const now = 1_000_000;
    expect(isSseSilent(now - (SSE_SILENCE_MS - 1), now)).toBe(false);
    expect(isSseSilent(now - (SSE_SILENCE_MS + 1), now)).toBe(true);
  });

  it("client resumes poll on silence without requiring EventSource onerror", () => {
    expect(dashboardHtml).toContain("SSE_SILENCE_MS");
    expect(dashboardHtml).toContain("sseSilentFallback");
    expect(dashboardHtml).toContain("function checkSseSilence()");
    expect(dashboardHtml).toContain("lastSseDataTime");
    expect(dashboardHtml).toMatch(
      /if \(!force && sseMode === 'live' && !sseReconnecting && !sseSilentFallback && data\) return/,
    );
    expect(PERIODIC_REFRESH_MS).toBeGreaterThan(WATCH_DEBOUNCE_MS);
    expect(SSE_SILENCE_MS).toBeGreaterThan(PERIODIC_REFRESH_MS);
  });
});
