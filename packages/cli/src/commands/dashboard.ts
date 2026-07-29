import { execFileSync, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { logger } from "../utils/logger.js";

/** Optional hooks for hermetic tests (inject moduleUrl; never required in production). */
export type FindDashboardOptions = {
  moduleUrl?: string;
};

/** Candidates for dashboard assets shipped beside the CLI package (Path C). */
export function bundledDashboardCandidates(
  filename: "start.mjs" | "start-broadcast.mjs",
  moduleUrl: string = import.meta.url,
): string[] {
  const here = path.dirname(fileURLToPath(moduleUrl));
  return [
    // Published / built: <pkg>/dist/index.js -> <pkg>/dashboard/
    path.join(here, "..", "dashboard", filename),
    // Dev source: packages/cli/src/commands/*.ts -> packages/cli/dashboard/ (sync copy)
    path.join(here, "..", "..", "dashboard", filename),
    // From src/commands: packages/dashboard/ (unused layout); from dist: two levels above package
    path.join(here, "..", "..", "..", "dashboard", filename),
  ];
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
 * Resolve dashboard/start.mjs for Mission Control.
 * Order: walk-up from cwd → env kit roots → sibling ../agent-kit → CLI-bundled (Path C).
 */
export async function findDashboardStart(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  options: FindDashboardOptions = {},
): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, "dashboard", "start.mjs");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const key of ["MISSION_CONTROL_KIT_ROOT", "AGENT_KIT_HOME"] as const) {
    const base = env[key];
    if (!base || typeof base !== "string" || !base.trim()) continue;
    const candidate = path.join(path.resolve(base.trim()), "dashboard", "start.mjs");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  // Maintainer layout: consumer checkout beside an `agent-kit` sibling.
  const sibling = path.join(path.resolve(cwd), "..", "agent-kit", "dashboard", "start.mjs");
  try {
    await access(sibling);
    return path.resolve(sibling);
  } catch {
    // fall through to bundled
  }

  return firstExisting(
    bundledDashboardCandidates("start.mjs", options.moduleUrl ?? import.meta.url),
  );
}

/** Prefer git toplevel when available so snapshots match the workspace root. */
export function resolveDashboardSnapshotRoot(cwd: string): string {
  const abs = path.resolve(cwd);
  try {
    const top = execFileSync("git", ["-C", abs, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (top) return path.resolve(top);
  } catch {
    // not a git tree
  }
  return abs;
}

function runStartScript(startPath: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [startPath], {
      cwd: path.dirname(path.dirname(startPath)),
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export const dashboardCommand = defineCommand({
  meta: {
    name: "dashboard",
    description:
      "Start Mission Control for this workspace (stable per-root port) and open the panel URL.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
      description:
        "Workspace to snapshot (git root preferred); also searched upward for dashboard/start.mjs",
    },
    "no-open": {
      type: "boolean",
      default: false,
      description: "Do not open a browser; only ensure the server is up and print the URL",
    },
  },
  async run({ args }) {
    const snapshotRoot = resolveDashboardSnapshotRoot(args.cwd);
    const startPath = await findDashboardStart(args.cwd);
    if (!startPath) {
      logger.error(
        "No dashboard/start.mjs found. After a CLI publish that ships dashboard/ (Path C), reinstall @dadado/agent-kit-cli. Or set MISSION_CONTROL_KIT_ROOT / AGENT_KIT_HOME to an agent-kit checkout, place a sibling ../agent-kit tree, or run from that kit tree.",
      );
      process.exitCode = 1;
      return;
    }

    const env = { ...process.env };
    env.MISSION_CONTROL_REPO_ROOT = snapshotRoot;
    if (args["no-open"]) env.MISSION_CONTROL_NO_OPEN = "1";

    const code = await runStartScript(startPath, env);
    if (code !== 0) process.exitCode = code;
  },
});
