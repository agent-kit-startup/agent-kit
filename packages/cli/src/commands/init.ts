import { intro, outro } from "@clack/prompts";
import { defineCommand } from "citty";
import { KIT_VERSION } from "../lifecycle/version.js";
import { logger } from "../utils/logger.js";
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
    description: "Guided compatibility entry point for install and repository readiness.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Project root directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    intro(`agent-kit v${KIT_VERSION}`);
    logger.info("init now uses the canonical install and readiness workflow.");
    const result = await runInitCompatibility(args.cwd);
    const pending = result.readiness.pendingActions.length;
    logger.success(`L0 and readiness prepared in ${result.projectRoot}`);
    outro(
      pending > 0
        ? "Next: run /agent-kit-onboard in Cursor to resolve the first pending action."
        : "Next: run /start-project in Cursor when you have a deliverable.",
    );
  },
});
