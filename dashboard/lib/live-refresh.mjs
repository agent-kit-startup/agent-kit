// dashboard/lib/live-refresh.mjs
// Pure helpers for Mission Control live refresh (watch coverage, debounce, silence).

import { join } from 'node:path';

/** Coalesce bursty fs.watch events into one trailing snapshot. */
export const WATCH_DEBOUNCE_MS = 400;

/**
 * When SSE clients are connected, re-broadcast on this interval so git / terminals /
 * processes (sources that do not touch watched files) cannot stay stale forever.
 */
export const PERIODIC_REFRESH_MS = 15000;

/** Client: if no SSE data payload arrives within this window, resume polling. */
export const SSE_SILENCE_MS = 45000;

/**
 * In-repo paths that dashboard-data.mjs reads. External sources (git state via
 * child_process, ~/.cursor terminals, `ps`) are not listed; they need periodic refresh.
 */
export const SNAPSHOT_REPO_SOURCE_RELS = Object.freeze([
  '.cursor/plans',
  '.cursor/HANDOFF.md',
  '.cursor/agents',
  '.cursor/commands',
  '.cursor/memory',
  '.cursor/context/config.json',
  '.cursor/context/current',
  '.cursor/context/readiness.json',
  '.cursor/skills',
  'package.json',
]);

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
    join(root, '.cursor'),
    join(root, 'package.json'),
    join(dashboardDir, 'dashboard-data.mjs'),
  ];
}

/**
 * True when `targetAbs` is the watch root or nested under it.
 * @param {string} watchAbs
 * @param {string} targetAbs
 */
export function watchCoversPath(watchAbs, targetAbs) {
  if (watchAbs === targetAbs) return true;
  const prefix = watchAbs.endsWith('/') ? watchAbs : `${watchAbs}/`;
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
 * @param {() => void} fn
 * @param {number} ms
 * @param {{ setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} [timers]
 */
export function createTrailingDebounce(fn, ms, timers = {}) {
  const schedule = timers.setTimeout || setTimeout;
  const cancel = timers.clearTimeout || clearTimeout;
  let handle = null;
  return () => {
    if (handle != null) cancel(handle);
    handle = schedule(() => {
      handle = null;
      fn();
    }, ms);
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
