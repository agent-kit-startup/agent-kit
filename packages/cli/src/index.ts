#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { addCommand } from "./commands/add.js";
import { contributeCommand } from "./commands/contribute.js";
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
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";
import { validateCommand } from "./commands/validate.js";

const main = defineCommand({
  meta: {
    name: "agent-kit",
    description: "HITL framework for AI-assisted IDEs",
  },
  subCommands: {
    init: initCommand,
    install: installCommand,
    scan: scanCommand,
    add: addCommand,
    doctor: doctorCommand,
    status: statusCommand,
    update: updateCommand,
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
});

runMain(main);
