// dashboard/lib/live-refresh.mjs
// Pure helpers for Mission Control live refresh (watch coverage, debounce, silence).

import { join, resolve } from "node:path";

/** Coalesce bursty fs.watch events into one trailing snapshot. */
export const WATCH_DEBOUNCE_MS = 400;

/**
 * When SSE clients are connected, re-broadcast on this interval so git / terminals /
 * processes (sources that do not touch watched files) cannot stay stale forever.
 */
export const PERIODIC_REFRESH_MS = 15000;

/**
 * Client: if no SSE data payload arrives within this window, resume polling.
 * Must stay above PERIODIC_REFRESH_MS; kept tight so a quiet stream cannot
 * suppress poll for long after the prior open-but-silent failure mode.
 */
export const SSE_SILENCE_MS = 20000;

/**
 * In-repo paths that dashboard-data.mjs reads. External sources (git state via
 * child_process, ~/.cursor terminals / agent-transcripts, `ps`) are not listed;
 * terminals/processes still need periodic refresh. Agent transcripts are watched
 * separately via resolveAgentTranscriptsWatchPath (not this allowlist).
 */
export const SNAPSHOT_REPO_SOURCE_RELS = Object.freeze([
  ".cursor/plans",
  ".cursor/HANDOFF.md",
  ".cursor/agents",
  ".cursor/commands",
  ".cursor/memory",
  ".cursor/context/config.json",
  ".cursor/context/current",
  ".cursor/context/readiness.json",
  ".cursor/context/field-report-dismissals.json",
  ".cursor/context/mission-timing.json",
  ".cursor/context/flight-log.json",
  ".cursor/context/field-report-cadence.json",
  ".cursor/skills",
  "package.json",
]);

/**
 * Cursor project slug for this repo: root path with `/` → `-` (leading dash stripped).
 * Matches `dashboard-data.mjs` terminals / agent-transcripts layout.
 * @param {string} root - repository root
 */
export function projectSlugFromRoot(root) {
  return String(root).replace(/\//g, "-").replace(/^-/, "");
}

/**
 * Absolute path to this project's agent-transcripts store (outside the repo).
 * Field Report prompt discovery reads here; it is not in SNAPSHOT_REPO_SOURCE_RELS.
 * @param {string} root - repository root
 * @param {string} [home] - HOME (defaults to process.env.HOME)
 * @returns {string}
 */
export function resolveAgentTranscriptsWatchPath(root, home = process.env.HOME || "") {
  const projectsDir = resolve(home || "~", ".cursor", "projects");
  return join(projectsDir, projectSlugFromRoot(root), "agent-transcripts");
}

/**
 * Resolve fs.watch roots. Watching `.cursor` covers create-after-start for HANDOFF
 * and nested sources (readiness, agents, skills) that a narrow allowlist missed.
 *
 * @param {string} root - repository root
 * @param {string} dashboardDir - dashboard/ directory
 * @returns {string[]}
 */
export function resolveWatchPaths(root, dashboardDir) {
  return [
    join(root, ".cursor"),
    join(root, "package.json"),
    join(dashboardDir, "dashboard-data.mjs"),
  ];
}

/**
 * True when `targetAbs` is the watch root or nested under it.
 * @param {string} watchAbs
 * @param {string} targetAbs
 */
export function watchCoversPath(watchAbs, targetAbs) {
  if (watchAbs === targetAbs) return true;
  const prefix = watchAbs.endsWith("/") ? watchAbs : `${watchAbs}/`;
  return targetAbs.startsWith(prefix);
}

/**
 * @param {string[]} watchAbsPaths
 * @param {string} targetAbs
 */
export function isCoveredByWatchPaths(watchAbsPaths, targetAbs) {
  return watchAbsPaths.some((w) => watchCoversPath(w, targetAbs));
}

/**
 * Trailing debounce: each call resets the timer; fn runs once after the quiet period.
 * Optional `maxWait` flushes even when calls never go quiet (watch-event storms).
 * @param {() => void} fn
 * @param {number} ms
 * @param {{
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout,
 *   now?: () => number,
 *   maxWait?: number,
 * }} [timers]
 */
export function createTrailingDebounce(fn, ms, timers = {}) {
  const schedule = timers.setTimeout || setTimeout;
  const cancel = timers.clearTimeout || clearTimeout;
  const nowFn = timers.now || Date.now;
  const maxWait = timers.maxWait;
  let handle = null;
  let firstScheduledAt = null;
  return () => {
    const now = nowFn();
    if (firstScheduledAt == null) firstScheduledAt = now;
    if (handle != null) cancel(handle);
    const invoke = () => {
      handle = null;
      firstScheduledAt = null;
      fn();
    };
    const elapsed = now - firstScheduledAt;
    if (maxWait != null && elapsed >= maxWait) {
      invoke();
      return;
    }
    const delay = maxWait != null ? Math.min(ms, Math.max(0, maxWait - elapsed)) : ms;
    handle = schedule(invoke, delay);
  };
}

/**
 * @param {number} lastEventAt - ms epoch of last SSE data payload
 * @param {number} now - ms epoch
 * @param {number} [silenceMs]
 */
export function isSseSilent(lastEventAt, now, silenceMs = SSE_SILENCE_MS) {
  if (!Number.isFinite(lastEventAt) || !Number.isFinite(now)) return false;
  return now - lastEventAt > silenceMs;
}
