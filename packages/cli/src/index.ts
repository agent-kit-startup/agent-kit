#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { addCommand } from "./commands/add.js";
import { contributeCommand } from "./commands/contribute.js";
import { diffCommand } from "./commands/diff.js";
import { handoffCommand } from "./commands/handoff.js";
import { initCommand } from "./commands/init.js";
import { installCommand } from "./commands/install.js";
import { scanCommand } from "./commands/scan.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";

const main = defineCommand({
  meta: {
    name: "agent-kit",
    description: "Developer bootstrapper for AI-assisted IDEs",
  },
  subCommands: {
    init: initCommand,
    install: installCommand,
    scan: scanCommand,
    add: addCommand,
    status: statusCommand,
    update: updateCommand,
    diff: diffCommand,
    contribute: contributeCommand,
    handoff: handoffCommand,
  },
});

runMain(main);
