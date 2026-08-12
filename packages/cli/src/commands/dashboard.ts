import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import { resolveContextConfigPath } from "../../../../dashboard/lib/guards.mjs";
import {
  normalizePreferredBrowser,
  readPreferredBrowserFromConfig,
} from "../../../../dashboard/lib/open-browser.mjs";
import { logger } from "../utils/logger.js";

/** Optional hooks for hermetic tests (inject moduleUrl; never required in production). */
export type FindDashboardOptions = {
  moduleUrl?: string;
};

/**
 * Resolve preferred browser from workspace context config (if present).
 * Returns null when unset / invalid / unsafe. Env override is applied by the starter.
 * Validation SoT: `normalizePreferredBrowser` in dashboard/lib/open-browser.mjs.
 * Path SoT: `resolveContextConfigPath` in dashboard/lib/guards.mjs.
 */
export function readPreferredBrowserFromWorkspace(
  cwd: string,
  readFile: typeof readFileSync = readFileSync,
): string | null {
  const resolved = resolveContextConfigPath(path.resolve(cwd), {
    existsSync,
    realpathSync,
  });
  if (!resolved.ok) return null;
  const value = readPreferredBrowserFromConfig(resolved.path, { readFileSync: readFile });
  return normalizePreferredBrowser(value);
}

/** Apply --no-open / --browser / config preferred browser onto env for the starter. */
export function applyDashboardOpenEnv(
  env: NodeJS.ProcessEnv,
  opts: { noOpen?: boolean; browser?: string; cwd?: string },
): NodeJS.ProcessEnv {
  const next = { ...env };
  if (opts.noOpen) next.MISSION_CONTROL_NO_OPEN = "1";
  const flag = opts.browser?.trim();
  if (flag) {
    const safe = normalizePreferredBrowser(flag);
    if (safe) next.MISSION_CONTROL_PREFERRED_BROWSER = safe;
  } else if (!next.MISSION_CONTROL_PREFERRED_BROWSER && opts.cwd) {
    const fromConfig = readPreferredBrowserFromWorkspace(opts.cwd);
    if (fromConfig) next.MISSION_CONTROL_PREFERRED_BROWSER = fromConfig;
  }
  return next;
}

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

/**
 * Resolve the Mission Control snapshot root.
 * Prefer the nearest Agent Kit install (`.cursor/agent-kit.json`) walking up from
 * cwd so nested monorepo packages are not overwritten by the git toplevel.
 * Fall back to git toplevel when no install marker is found, then cwd.
 */
export function resolveDashboardSnapshotRoot(cwd: string): string {
  const abs = path.resolve(cwd);
  let dir = abs;
  for (;;) {
    if (existsSync(path.join(dir, ".cursor", "agent-kit.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
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
    description: "Start Mission Control for this workspace (loopback; opens panel URL).",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
      description:
        "Workspace to snapshot (nearest .cursor/agent-kit.json, else git root); also searched upward for dashboard/start.mjs",
    },
    "no-open": {
      type: "boolean",
      default: false,
      description: "Do not open a browser; only ensure the server is up and print the URL",
    },
    browser: {
      type: "string",
      description:
        "Preferred browser app/binary for this launch (overrides config missionControl.preferredBrowser)",
    },
  },
  async run({ args }) {
    const snapshotRoot = resolveDashboardSnapshotRoot(args.cwd);
    const startPath = await findDashboardStart(args.cwd);
    if (!startPath) {
      logger.error("No dashboard/start.mjs found.");
      console.error(
        [
          "",
          "The dashboard runtime is not available in this workspace.",
          "L0 install provides the /dashboard command text but not the panel itself.",
          "",
          "Recovery (pick one):",
          "  1. Upgrade the CLI: npx @dadado/agent-kit-cli@latest dashboard",
          "     (Path C ships dashboard/ from 4.8.2 onward)",
          "  2. Set an env var pointing to an agent-kit checkout:",
          "     export MISSION_CONTROL_KIT_ROOT=/path/to/agent-kit",
          "     agent-kit dashboard",
          "  3. Place an agent-kit sibling: ../agent-kit/dashboard/start.mjs",
          "  4. Run directly from a kit tree: node dashboard/start.mjs",
          "",
          "Works in Cursor, VS Code, and any Node.js terminal.",
          "",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }

    const env = applyDashboardOpenEnv(
      { ...process.env, MISSION_CONTROL_REPO_ROOT: snapshotRoot },
      { noOpen: Boolean(args["no-open"]), browser: args.browser, cwd: snapshotRoot },
    );

    const code = await runStartScript(startPath, env);
    if (code !== 0) process.exitCode = code;
  },
});
