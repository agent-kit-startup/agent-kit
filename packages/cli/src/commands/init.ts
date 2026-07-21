import path from "node:path";
import { intro, outro } from "@clack/prompts";
import { defineCommand } from "citty";
import { generateFromProfile } from "../generator/index.js";
import { installSkillsByIds } from "../registry/install.js";
import { resolveRegistryRoot } from "../registry/resolve.js";
import { runScanner } from "../scanner/scan.js";
import { writeJson } from "../utils/fs.js";
import { logger } from "../utils/logger.js";
import { runExistingProjectWizard, runGreenfieldWizard } from "../utils/prompts.js";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Run scanner + wizard + generation setup.",
  },
  args: {
    cwd: {
      type: "string",
      description: "Project root directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    intro("agent-kit v3.0.0");

    const scan = await runScanner(args.cwd);
    logger.info(`Root: ${scan.rootDir}`);
    logger.info(
      scan.isGreenfield ? "Empty repo detected (greenfield)." : "Existing project detected.",
    );

    const profile = scan.isGreenfield
      ? await runGreenfieldWizard(scan)
      : await runExistingProjectWizard(scan);

    const configPath = path.join(scan.rootDir, ".cursor", "agent-kit.config.json");
    await writeJson(configPath, profile);
    logger.success(`Profile saved in ${configPath}`);

    await generateFromProfile(profile);

    try {
      const registry = await resolveRegistryRoot({ cwd: scan.rootDir });
      const stats = await installSkillsByIds(
        registry.root,
        scan.rootDir,
        profile.selectedCoreComponents,
      );
      if (stats.written.length > 0) {
        logger.success(`Skills installed: ${stats.written.join(", ")}`);
      } else if (stats.missing.length > 0) {
        logger.warn(`Skills not found in registry: ${stats.missing.join(", ")}`);
      } else {
        logger.info("No new skills to copy (already installed or empty selection).");
      }
    } catch {
      logger.info(
        "Registry unavailable in this directory: use agent-kit install / agent-kit add <id> with --registry or remote cache.",
      );
    }

    console.log("\nNext:");
    console.log(`  Open this folder in Cursor: ${scan.rootDir}`);
    console.log("  Run /onboard in chat; then /start-project when you have a goal");
    console.log("  Optional: agent-kit status");
    outro("Setup completed.");
  },
});
