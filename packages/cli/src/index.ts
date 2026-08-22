#!/usr/bin/env node
import { defineCommand, runMain, showUsage } from "citty";
import { addCommand } from "./commands/add.js";
import { contributeCommand } from "./commands/contribute.js";
import { cursorAwarenessCommand } from "./commands/cursor-awareness.js";
import { dashboardBroadcastCommand } from "./commands/dashboard-broadcast.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { diffCommand } from "./commands/diff.js";
import { doctorCommand } from "./commands/doctor.js";
import { guardCommand } from "./commands/guard.js";
import { handoffCommand } from "./commands/handoff.js";
import { hookCommand } from "./commands/hook.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { monitorsCommand } from "./commands/monitors.js";
import { runPlanCommand } from "./commands/run-plan.js";
import { scanCommand } from "./commands/scan.js";
import { setupGlobalCommand } from "./commands/setup-global.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import { validateCommand } from "./commands/validate.js";
import { KIT_VERSION } from "./lifecycle/version.js";
import { renderGroupedRootHelp } from "./welcome/help-groups.js";
import { hasCliSubcommand, printWelcomeScreen } from "./welcome/screen.js";

const main = defineCommand({
  meta: {
    name: "agent-kit",
    description: "HITL framework for AI-assisted IDEs (Mission Kit family)",
    version: KIT_VERSION,
  },
  subCommands: {
    init: initCommand,
    install: installCommand,
    scan: scanCommand,
    add: addCommand,
    doctor: doctorCommand,
    "setup-global": setupGlobalCommand,
    status: statusCommand,
    update: updateCommand,
    "cursor-awareness": cursorAwarenessCommand,
    diff: diffCommand,
    contribute: contributeCommand,
    handoff: handoffCommand,
    "run-plan": runPlanCommand,
    dashboard: dashboardCommand,
    "dashboard-broadcast": dashboardBroadcastCommand,
    hook: hookCommand,
    guard: guardCommand,
    monitors: monitorsCommand,
    validate: validateCommand,
  },
  async run({ rawArgs }) {
    // citty also invokes parent `run` after a subcommand; skip when one was selected.
    if (hasCliSubcommand(rawArgs)) return;
    printWelcomeScreen();
  },
});

runMain(main, {
  showUsage: async (cmd, parent) => {
    if (!parent) {
      process.stdout.write(`${await renderGroupedRootHelp(cmd)}\n`);
      return;
    }
    await showUsage(cmd, parent);
  },
});
