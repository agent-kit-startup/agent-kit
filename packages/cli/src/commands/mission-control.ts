import { defineCommand } from "citty";
import { runMcTuiLoop } from "../mission-control/loop.js";
import {
  findDashboardDataScript,
  loadDashboardSnapshot,
  resolveDashboardSnapshotRoot,
} from "../mission-control/snapshot.js";
import { buildMcTuiView } from "../mission-control/view.js";
import { logger } from "../utils/logger.js";

export const missionControlCommand = defineCommand({
  meta: {
    name: "mission-control",
    description:
      "ASCII Mission Control (mission, flight log, checklist, crew monitor) without a browser.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
      description: "Workspace to snapshot (nearest .cursor/agent-kit.json, else git root)",
    },
    once: {
      type: "boolean",
      default: false,
      description: "Print one frame and exit (Claude Code / non-TTY / CI)",
    },
  },
  async run({ args }) {
    const snapshotRoot = resolveDashboardSnapshotRoot(args.cwd);
    const dataScript = await findDashboardDataScript(args.cwd);
    if (!dataScript) {
      logger.error("No dashboard/dashboard-data.mjs found.");
      console.error(
        [
          "",
          "The Mission Control snapshot script is not available in this workspace.",
          "The TUI reuses the Path C dashboard data collector; it does not start an HTTP server.",
          "",
          "Recovery (pick one):",
          "  1. Upgrade the CLI: npx @dadado/agent-kit-cli@latest mission-control",
          "  2. Set MISSION_CONTROL_KIT_ROOT or AGENT_KIT_HOME to an agent-kit checkout",
          "  3. Place an agent-kit sibling: ../agent-kit/dashboard/dashboard-data.mjs",
          "",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }

    const handle = await runMcTuiLoop({
      once: Boolean(args.once),
      stdoutIsTTY: Boolean(process.stdout.isTTY),
      env: process.env,
      renderOpts: { stdoutIsTTY: Boolean(process.stdout.isTTY) },
      loadView: async () => {
        const loaded = await loadDashboardSnapshot({
          dataScript,
          snapshotRoot,
        });
        if (!loaded.ok) return buildMcTuiView(null, loaded.error);
        return buildMcTuiView(loaded.snapshot);
      },
      hooks: {
        write: (chunk) => {
          process.stdout.write(chunk);
        },
        stdin: process.stdin,
        exit: (code) => {
          process.exit(code);
        },
      },
    });

    if (!handle) return;

    const onSignal = () => {
      handle.stop();
      process.exit(0);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  },
});
