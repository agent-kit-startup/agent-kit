#!/usr/bin/env node
import { defineCommand, runMain, showUsage } from "citty";
import { KIT_VERSION } from "./lifecycle/version.js";
import { rewriteRootArgvToRun } from "./plan-loop/dispatch.js";
import { renderGroupedRootHelp } from "./welcome/help-groups.js";
import { hasCliSubcommand, printWelcomeScreen } from "./welcome/screen.js";

const rewrittenArgv = rewriteRootArgvToRun(process.argv.slice(2));
process.argv.length = 2;
process.argv.push(...rewrittenArgv);

const main = defineCommand({
  meta: {
    name: "agent-kit",
    description: "HITL framework for AI-assisted IDEs (Mission Kit family)",
    version: KIT_VERSION,
  },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.initCommand),
    install: () => import("./commands/install.js").then((m) => m.installCommand),
    scan: () => import("./commands/scan.js").then((m) => m.scanCommand),
    add: () => import("./commands/add.js").then((m) => m.addCommand),
    doctor: () => import("./commands/doctor.js").then((m) => m.doctorCommand),
    "setup-global": () => import("./commands/setup-global.js").then((m) => m.setupGlobalCommand),
    status: () => import("./commands/status.js").then((m) => m.statusCommand),
    update: () => import("./commands/update.js").then((m) => m.updateCommand),
    "cursor-awareness": () =>
      import("./commands/cursor-awareness.js").then((m) => m.cursorAwarenessCommand),
    "public-inbound-radar": () =>
      import("./commands/public-inbound-radar.js").then((m) => m.publicInboundRadarCommand),
    "remote-issues": () => import("./commands/remote-issues.js").then((m) => m.remoteIssuesCommand),
    dogfood: () => import("./commands/dogfood.js").then((m) => m.dogfoodCommand),
    diff: () => import("./commands/diff.js").then((m) => m.diffCommand),
    contribute: () => import("./commands/contribute.js").then((m) => m.contributeCommand),
    handoff: () => import("./commands/handoff.js").then((m) => m.handoffCommand),
    "plan-index": () => import("./commands/plan-index.js").then((m) => m.planIndexCommand),
    run: () => import("./commands/run.js").then((m) => m.runCommand),
    "run-plan": () => import("./commands/run-plan.js").then((m) => m.runPlanCommand),
    "run-plan-all": () => import("./commands/run.js").then((m) => m.runPlanAllCommand),
    dashboard: () => import("./commands/dashboard.js").then((m) => m.dashboardCommand),
    "dashboard-broadcast": () =>
      import("./commands/dashboard-broadcast.js").then((m) => m.dashboardBroadcastCommand),
    "mission-control": () =>
      import("./commands/mission-control.js").then((m) => m.missionControlCommand),
    hook: () => import("./commands/hook.js").then((m) => m.hookCommand),
    guard: () => import("./commands/guard.js").then((m) => m.guardCommand),
    monitors: () => import("./commands/monitors.js").then((m) => m.monitorsCommand),
    validate: () => import("./commands/validate.js").then((m) => m.validateCommand),
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
