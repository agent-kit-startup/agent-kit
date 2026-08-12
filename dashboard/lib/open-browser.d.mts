import type { spawn, spawnSync } from "node:child_process";
import type { readFileSync } from "node:fs";

export const OS_DEFAULT_TOKENS: Set<string>;
export function isSafePreferredBrowser(value: string): boolean;
export function shouldSkipOpen(env?: NodeJS.ProcessEnv): boolean;
export function normalizePreferredBrowser(value: unknown): string | null;
export function resolvePreferredBrowser(opts?: {
  env?: NodeJS.ProcessEnv;
  configValue?: unknown;
}): string | null;
export function readPreferredBrowserFromConfig(
  configPath: string,
  fsHooks?: { readFileSync?: typeof readFileSync },
): unknown;
export function buildOpenBrowserCommand(opts: {
  url: string;
  preferred?: string | null;
  platform?: NodeJS.Platform;
}): { command: string; args: string[] } | null;
export function openBrowser(
  url: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    preferred?: string | null;
    configValue?: unknown;
    platform?: NodeJS.Platform;
    spawnFn?: typeof spawn;
    spawnSyncFn?: typeof spawnSync;
  },
): { opened: boolean; reason?: string; command?: string; args?: string[] };
