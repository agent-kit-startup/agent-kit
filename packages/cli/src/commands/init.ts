import { intro, outro } from "@clack/prompts";
import { defineCommand } from "citty";
import { KIT_VERSION } from "../lifecycle/version.js";
import { logger } from "../utils/logger.js";
import { classifyInstallError, isNonInteractive } from "../utils/terminal.js";
import { type InstallResult, performInstall } from "./install.js";

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
  },
  async run({ args }) {
    const nonInteractive = isNonInteractive();
    if (!nonInteractive) {
      intro(`agent-kit v${KIT_VERSION}`);
    } else {
      logger.info(`agent-kit v${KIT_VERSION} (non-interactive mode)`);
    }
    logger.info("init now uses the canonical install and readiness workflow.");
    try {
      const result = await runInitCompatibility(args.cwd);
      const pending = result.readiness.pendingActions.length;
      logger.success(`L0 and readiness prepared in ${result.projectRoot}`);
      const nextStep =
        pending > 0
          ? "Next: run /agent-kit-onboard in Cursor to resolve the first pending action."
          : "Next: run /start-project in Cursor when you have a deliverable.";
      if (!nonInteractive) {
        outro(nextStep);
      } else {
        logger.info(nextStep);
      }
    } catch (err) {
      const hint = classifyInstallError(err);
      logger.error(hint.message);
      console.error(`\n${hint.recovery}\n`);
      process.exit(1);
    }
  },
});
