import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { defineCommand } from "citty";
import { logger } from "../utils/logger.js";

/** Walk cwd and parents for `dashboard/start.mjs` (kit monorepo / dogfood root). */
export async function findDashboardStart(cwd: string): Promise<string | null> {
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

export const dashboardCommand = defineCommand({
  meta: {
    name: "dashboard",
    description:
      "Start Mission Control if needed and open http://localhost:3333 (terminal counterpart to /dashboard).",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
      description: "Directory to search upward for dashboard/start.mjs",
    },
    "no-open": {
      type: "boolean",
      default: false,
      description: "Do not open a browser; only ensure the server is up and print the URL",
    },
  },
  async run({ args }) {
    const startPath = await findDashboardStart(args.cwd);
    if (!startPath) {
      logger.error(
        "No dashboard/start.mjs found. Mission Control ships with the agent-kit repo; run from that tree, or use npm run dashboard there.",
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
