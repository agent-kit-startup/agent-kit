import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { defineCommand } from "citty";
import { logger } from "../utils/logger.js";
import { findDashboardStart } from "./dashboard.js";

/** Walk cwd and parents for `dashboard/start-broadcast.mjs`. */
export async function findDashboardBroadcastStart(cwd: string): Promise<string | null> {
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
    if (parent === dir) return null;
    dir = parent;
  }
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
      description: "Do not open a browser; only ensure the server is up and print LAN URL + token",
    },
  },
  async run({ args }) {
    const startPath = await findDashboardBroadcastStart(args.cwd);
    if (!startPath) {
      // Helpful tip if only the loopback starter exists.
      const loopback = await findDashboardStart(args.cwd);
      logger.error(
        loopback
          ? "No dashboard/start-broadcast.mjs found beside dashboard/start.mjs. Update the agent-kit tree, then retry."
          : "No dashboard/start-broadcast.mjs found. Mission Control ships with the agent-kit repo; run from that tree.",
      );
      process.exitCode = 1;
      return;
    }

    const env = { ...process.env };
    if (args["no-open"]) env.MISSION_CONTROL_NO_OPEN = "1";

    const code = await runStartScript(startPath, env);
    if (code !== 0) process.exitCode = code;
  },
});
