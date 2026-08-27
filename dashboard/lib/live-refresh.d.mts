/** Ambient types for dashboard/lib/live-refresh.mjs (consumed by CLI TypeScript). */

export const WATCH_DEBOUNCE_MS: 400;
export const PERIODIC_REFRESH_MS: 15000;
export const SSE_SILENCE_MS: 20000;
export const SNAPSHOT_REPO_SOURCE_RELS: readonly string[];

export function projectSlugFromRoot(root: string): string;
export function resolveAgentTranscriptsWatchPath(root: string, home?: string): string;
export function resolveWatchPaths(root: string, dashboardDir: string): string[];
export function watchCoversPath(watchAbs: string, targetAbs: string): boolean;
export function isCoveredByWatchPaths(watchAbsPaths: string[], targetAbs: string): boolean;
export function createTrailingDebounce(
  fn: () => void,
  ms: number,
  timers?: {
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    now?: () => number;
    maxWait?: number;
  },
): () => void;
export function isSseSilent(lastEventAt: number, now: number, silenceMs?: number): boolean;
