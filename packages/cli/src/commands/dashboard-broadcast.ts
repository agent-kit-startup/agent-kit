import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { defineCommand } from "citty";
import { logger } from "../utils/logger.js";
import {
  type FindDashboardOptions,
  applyDashboardOpenEnv,
  bundledDashboardCandidates,
  findDashboardStart,
  resolveDashboardSnapshotRoot,
} from "./dashboard.js";

/**
 * Resolve dashboard/start-broadcast.mjs.
 * Order: walk-up → env kit roots → sibling ../agent-kit → CLI-bundled (Path C).
 */
export async function findDashboardBroadcastStart(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  options: FindDashboardOptions = {},
): Promise<string | null> {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, "dashboard", "start-broadcast.mjs");
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
    const candidate = path.join(path.resolve(base.trim()), "dashboard", "start-broadcast.mjs");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }

  const sibling = path.join(
    path.resolve(cwd),
    "..",
    "agent-kit",
    "dashboard",
    "start-broadcast.mjs",
  );
  try {
    await access(sibling);
    return path.resolve(sibling);
  } catch {
    // fall through
  }

  for (const candidate of bundledDashboardCandidates(
    "start-broadcast.mjs",
    options.moduleUrl ?? import.meta.url,
  )) {
    try {
      await access(candidate);
      return path.resolve(candidate);
    } catch {
      // try next
    }
  }
  return null;
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

export const dashboardBroadcastCommand = defineCommand({
  meta: {
    name: "dashboard-broadcast",
    description:
      "Opt-in LAN Mission Control (token-gated). Terminal counterpart to /dashboard-broadcast. Does not change loopback /dashboard.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
      description: "Directory to search upward for dashboard/start-broadcast.mjs",
    },
    "no-open": {
      type: "boolean",
      default: false,
      description:
        "Do not open a browser; only ensure the server is up and print Share URL (when masking is on) plus token / LAN lines",
    },
    browser: {
      type: "string",
      description:
        "Preferred browser app/binary for this launch (overrides config missionControl.preferredBrowser)",
    },
  },
  async run({ args }) {
    const startPath = await findDashboardBroadcastStart(args.cwd);
    if (!startPath) {
      const loopback = await findDashboardStart(args.cwd);
      logger.error(
        loopback
          ? "No dashboard/start-broadcast.mjs found beside dashboard/start.mjs. Update the agent-kit tree or reinstall a CLI that ships dashboard/, then retry."
          : "No dashboard/start-broadcast.mjs found. After a CLI publish that ships dashboard/ (Path C), reinstall @dadado/agent-kit-cli. Or run from an agent-kit tree that includes dashboard/.",
      );
      process.exitCode = 1;
      return;
    }

    const snapshotRoot = resolveDashboardSnapshotRoot(args.cwd);
    const env = applyDashboardOpenEnv(
      { ...process.env },
      { noOpen: Boolean(args["no-open"]), browser: args.browser, cwd: snapshotRoot },
    );

    const code = await runStartScript(startPath, env);
    if (code !== 0) process.exitCode = code;
  },
});
