/**
 * Read-only Mission Control snapshot for the CLI TUI.
 * Spawns dashboard/dashboard-data.mjs (same as serve.mjs); no HTTP server.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT_ENV } from "../../../../dashboard/lib/guards.mjs";
import { PERIODIC_REFRESH_MS } from "../../../../dashboard/lib/live-refresh.mjs";
import {
  type FindDashboardOptions,
  bundledDashboardCandidates,
  findDashboardStart,
  resolveDashboardSnapshotRoot,
} from "../commands/dashboard.js";

export { PERIODIC_REFRESH_MS, resolveDashboardSnapshotRoot };

export const DEFAULT_DATA_TIMEOUT_MS = 60_000;

export function dataScriptTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS;
  const n = raw != null && raw !== "" ? Number(raw) : DEFAULT_DATA_TIMEOUT_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DATA_TIMEOUT_MS;
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return path.resolve(candidate);
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Resolve dashboard/dashboard-data.mjs beside start.mjs (cwd walk, env, sibling, Path C).
 */
export async function findDashboardDataScript(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  options: FindDashboardOptions = {},
): Promise<string | null> {
  const startPath = await findDashboardStart(cwd, env, options);
  if (startPath) {
    const sibling = path.join(path.dirname(startPath), "dashboard-data.mjs");
    try {
      await access(sibling);
      return sibling;
    } catch {
      // fall through to bundled data-script candidates
    }
  }
  return firstExisting(
    bundledDashboardCandidates("dashboard-data.mjs", options.moduleUrl ?? import.meta.url),
  );
}

export type ExecFileFn = (
  file: string,
  args: string[],
  options: {
    cwd?: string;
    encoding?: BufferEncoding;
    maxBuffer?: number;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  },
  callback: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

export type SnapshotLoadResult =
  | { ok: true; snapshot: Record<string, unknown> }
  | { ok: false; error: string };

export async function loadDashboardSnapshot(opts: {
  dataScript: string;
  snapshotRoot: string;
  env?: NodeJS.ProcessEnv;
  execFileFn?: ExecFileFn;
}): Promise<SnapshotLoadResult> {
  const env = opts.env ?? process.env;
  const timeout = dataScriptTimeoutMs(env);
  const run = opts.execFileFn ?? (execFile as unknown as ExecFileFn);
  const snapshotRoot = path.resolve(opts.snapshotRoot);
  return new Promise((resolve) => {
    run(
      process.execPath,
      [opts.dataScript],
      {
        cwd: snapshotRoot,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout,
        env: {
          ...env,
          [REPO_ROOT_ENV]: snapshotRoot,
        },
      },
      (err, stdout) => {
        if (err) {
          const killed = Boolean(
            err &&
              typeof err === "object" &&
              "killed" in err &&
              (err as { killed?: boolean }).killed,
          );
          const message = killed
            ? `dashboard-data.mjs timed out after ${timeout}ms (set AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS to raise)`
            : err.message;
          resolve({ ok: false, error: message });
          return;
        }
        try {
          const parsed: unknown = JSON.parse(String(stdout ?? ""));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            resolve({ ok: false, error: "dashboard-data.mjs returned non-object JSON" });
            return;
          }
          resolve({ ok: true, snapshot: parsed as Record<string, unknown> });
        } catch {
          resolve({ ok: false, error: "dashboard-data.mjs returned invalid JSON" });
        }
      },
    );
  });
}
