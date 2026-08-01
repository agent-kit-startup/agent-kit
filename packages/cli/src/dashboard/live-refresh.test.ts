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
  projectSlugFromRoot,
  resolveAgentTranscriptsWatchPath,
  resolveWatchPaths,
} from "../../../../dashboard/lib/live-refresh.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const serveSource = readFileSync(resolve(repoRoot, "dashboard/serve.mjs"), "utf8");
const dashboardHtml = readFileSync(resolve(repoRoot, "dashboard/dashboard.html"), "utf8");
const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");

describe("dashboard-data: handoff health", () => {
  it("treats present HANDOFF as healthy even when Plan is none/null (idle)", () => {
    // Idle HANDOFF (Plan: none) parses without .plan; requiring plan flipped transport to Warning.
    expect(dataSource).toMatch(/id:\s*["']handoff["'][\s\S]*?ok:\s*!!SNAPSHOT\.system\.handoff\b/);
    expect(dataSource).not.toMatch(
      /id:\s*["']handoff["'][\s\S]*?ok:\s*!!SNAPSHOT\.system\.handoff\?\.plan/,
    );
  });
});

describe("dashboard-data: agents health L0-optional", () => {
  it("keeps check id agents but does not hard-fail on empty inventory", () => {
    expect(dataSource).toMatch(/id:\s*["']agents["'][\s\S]*?ok:\s*true\b/);
    expect(dataSource).not.toMatch(
      /id:\s*["']agents["'][\s\S]*?ok:\s*SNAPSHOT\.agents\.length\s*>\s*0/,
    );
  });

  it("maps Healthcenter agents autofix to null (ok is constant-true)", () => {
    const agentsMeta = dashboardHtml.match(/agents:\s*\{[\s\S]*?autofix:\s*null,?\s*\n\s*\},/)?.[0];
    expect(agentsMeta).toBeTruthy();
    expect(agentsMeta).toContain("Intentionally unreachable");
    expect(agentsMeta).toContain("autofix: null");
    expect(agentsMeta).not.toMatch(/autofix:\s*\{/);
  });
});

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
    expect(serveSource).toContain("resolveAgentTranscriptsWatchPath");
    expect(serveSource).toContain("PERIODIC_REFRESH_MS");
    expect(serveSource).toContain("createTrailingDebounce");
    expect(serveSource).toMatch(/from ['"]\.\/lib\/live-refresh\.mjs['"]/);
    expect(serveSource).toMatch(/sseClients\.size === 0/);
    // Async single-flight returns the shared Promise (not a sync busy flag).
    expect(serveSource).toMatch(/@type \{Promise<string> \| null\}/);
    expect(serveSource).toMatch(/return inFlight;/);
    // Periodic must call flushBroadcast directly (not the watch debounce),
    // or continuous .cursor writes starve the cadence forever.
    expect(serveSource).toContain("async function flushBroadcast");
    expect(serveSource).toMatch(
      /Date\.now\(\) - lastBroadcastAt < PERIODIC_REFRESH_MS[\s\S]*?void flushBroadcast\(\)/,
    );
    expect(serveSource).toContain("maxWait: PERIODIC_REFRESH_MS");
    // Sync execFileSync blocked heartbeats; generation must stay async.
    expect(serveSource).toContain("execFile");
    expect(serveSource).not.toContain("execFileSync");
    // Pretty JSON must be compacted before SSE write (line-oriented wire format).
    expect(serveSource).toContain("function toSseDataLine");
    expect(serveSource).toContain("JSON.stringify(JSON.parse(data))");
  });

  it("watches agent-transcripts outside the repo for Field Report prompts", () => {
    const root = "/Users/me/Documents/Git/agent-kit";
    const home = "/Users/me";
    const slug = projectSlugFromRoot(root);
    expect(slug).toBe("Users-me-Documents-Git-agent-kit");
    const transcripts = resolveAgentTranscriptsWatchPath(root, home);
    expect(transcripts).toBe(join(home, ".cursor", "projects", slug, "agent-transcripts"));
    // External path must not be claimed as an in-repo SNAPSHOT source.
    expect(SNAPSHOT_REPO_SOURCE_RELS.every((rel) => !rel.includes("agent-transcripts"))).toBe(true);
    const inRepo = resolveWatchPaths(root, join(root, "dashboard"));
    expect(isCoveredByWatchPaths(inRepo, transcripts)).toBe(false);
    // serve.mjs schedules the same trailing debounce on transcript watch events.
    expect(serveSource).toContain("resolveAgentTranscriptsWatchPath(ROOT)");
    expect(serveSource).toMatch(
      /allWatchPaths[\s\S]*?watch\(p, \{ recursive: true \}, \(\) => \{\s*scheduleBroadcast\(\);/,
    );
    // Discovery bound: WATCH_DEBOUNCE_MS ≪ PERIODIC_REFRESH_MS (honest fallback: periodic).
    expect(WATCH_DEBOUNCE_MS).toBeLessThan(PERIODIC_REFRESH_MS / 10);
  });

  it("documents readiness.json as a snapshot source (regression for prior gap)", () => {
    expect(dataSource).toContain("readiness.json");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/context/readiness.json");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/agents");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/skills");
  });

  it("documents config.json deferredItems path for Checklist readiness clear", () => {
    expect(dataSource).toContain("collectDeferredCheckIds");
    expect(dataSource).toContain("collectOnboardingDeferredCheckIds");
    expect(dataSource).toContain("deferredCheckIds");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/context/config.json");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/context/readiness.json");
  });

  it("documents field-report-dismissals.json as a snapshot source", () => {
    expect(dataSource).toContain("field-report-dismissals.json");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/context/field-report-dismissals.json");
  });

  it("documents mission-timing.json as a snapshot source and write-on-change persist", () => {
    expect(dataSource).toContain("MISSION_TIMING_LEDGER_REL");
    expect(dataSource).toContain("persistMissionTimingLedger");
    expect(dataSource).toContain("collectMissionTimingLedger");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/context/mission-timing.json");
  });

  it("documents flight-log.json as a snapshot source and write-on-change persist", () => {
    expect(dataSource).toContain("FLIGHT_LOG_LEDGER_REL");
    expect(dataSource).toContain("persistFlightLogLedger");
    expect(dataSource).toContain("collectFlightLogLedger");
    expect(SNAPSHOT_REPO_SOURCE_RELS).toContain(".cursor/context/flight-log.json");
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

  it("flushes via maxWait when calls never go quiet", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const calls: number[] = [];
    const maxWait = 1000;
    const debounced = createTrailingDebounce(() => calls.push(1), 400, {
      maxWait,
      now: () => Date.now(),
    });
    debounced();
    expect(calls).toHaveLength(0);
    // Keep poking every 200ms so the trailing 400ms quiet window never opens.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(200);
      vi.setSystemTime(Date.now());
      debounced();
      expect(calls).toHaveLength(0);
    }
    // elapsed == maxWait on the next call → immediate flush
    vi.advanceTimersByTime(200);
    vi.setSystemTime(Date.now());
    debounced();
    expect(calls).toHaveLength(1);
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
    // onopen must not reset lastSseDataTime (reconnect storms defeated silence).
    const onopenBlock = dashboardHtml.match(/sseSource\.onopen = \(\) => \{[\s\S]*?\n {4}\};/)?.[0];
    expect(onopenBlock).toBeTruthy();
    expect(onopenBlock).not.toMatch(/lastSseDataTime\s*=\s*Date\.now\(\)/);
    expect(dashboardHtml).toContain("Catching up");
    // lastSseDataTime only after validated plans[] payload (not on raw onmessage).
    const onmessageBlock = dashboardHtml.match(
      /sseSource\.onmessage = \(event\) => \{[\s\S]*?\n {4}\};/,
    )?.[0];
    expect(onmessageBlock).toBeTruthy();
    expect(onmessageBlock).toMatch(
      /Array\.isArray\(newData\.plans\)[\s\S]*lastSseDataTime\s*=\s*Date\.now\(\)/,
    );
    const beforeValidate = onmessageBlock.split("Array.isArray(newData.plans)")[0];
    expect(beforeValidate).not.toMatch(/lastSseDataTime\s*=\s*Date\.now\(\)/);
  });
});
