import { intro, outro } from "@clack/prompts";
import { defineCommand } from "citty";
import { KIT_VERSION } from "../lifecycle/version.js";
import { assessEnvironment } from "../readiness/env-checks.js";
import { logger } from "../utils/logger.js";
import {
  RootRefusedError,
  classifyInstallError,
  confirmProjectRoot,
  isNonInteractive,
} from "../utils/terminal.js";
import { withCliProgress } from "../welcome/visual-kit.js";
import {
  type InstallResult,
  nextStepAfterInstall,
  performInstall,
  printInstallEpilogue,
} from "./install.js";

type CompatibilityInstaller = (options: { cwd: string }) => Promise<InstallResult>;

export async function runInitCompatibility(
  cwd: string,
  installer: CompatibilityInstaller = performInstall,
): Promise<InstallResult> {
  return installer({ cwd });
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Guided setup entry (compat path to install + readiness).",
  },
  args: {
    cwd: {
      type: "string",
      description: "Project root directory",
      default: process.cwd(),
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip interactive prompts; use defaults (IDE-agnostic non-interactive mode)",
      default: false,
    },
    "force-root": {
      type: "boolean",
      description: "Bypass the ambiguous-root guard (use with caution)",
      default: false,
    },
  },
  async run({ args }) {
    const nonInteractive = args.yes || isNonInteractive();
    if (!nonInteractive) {
      intro(`agent-kit v${KIT_VERSION}`);
    } else {
      logger.info(`agent-kit v${KIT_VERSION} (non-interactive mode)`);
    }
    logger.info("init now uses the canonical install and readiness workflow.");

    // init is a compat wrapper over performInstall, which writes L0. It owes
    // the same root confirm as `install`: without it, `init` silently wrote
    // into a blank no-git folder or a parent-of-repos root.
    let projectRoot: string;
    try {
      projectRoot = await confirmProjectRoot(args.cwd, {
        nonInteractive,
        command: "install",
        forceRoot: args["force-root"],
      });
    } catch (err) {
      if (err instanceof RootRefusedError) {
        logger.error(err.message);
        if (err.recovery) console.error(`\n${err.recovery}\n`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    try {
      const result = await withCliProgress("init", () => runInitCompatibility(projectRoot));
      const pending = result.readiness.pendingActions.length;
      logger.success(`L0 and readiness prepared in ${result.projectRoot}`);
      const nextStep = nextStepAfterInstall(pending);
      const env = await assessEnvironment();
      // npx is ephemeral: never point the operator at a bare `agent-kit` here
      // unless the environment probe confirms one is already on PATH.
      if (!nonInteractive) {
        printInstallEpilogue(env);
        outro(nextStep);
      } else {
        logger.info(nextStep);
        printInstallEpilogue(env);
      }
    } catch (err) {
      const hint = classifyInstallError(err);
      logger.error(hint.message);
      console.error(`\n${hint.recovery}\n`);
      process.exit(1);
    }
  },
});
