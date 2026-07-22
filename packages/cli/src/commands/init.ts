import path from "node:path";
import { intro, outro } from "@clack/prompts";
import { defineCommand } from "citty";
import { generateFromProfile } from "../generator/index.js";
import { installSkillsByIds } from "../registry/install.js";
import { resolveRegistryRoot } from "../registry/resolve.js";
import { runScanner } from "../scanner/scan.js";
import type { WorkspaceSkinConfig } from "../types.js";
import { ensureDir, readJson, writeJson } from "../utils/fs.js";
import { logger } from "../utils/logger.js";
import {
  runExistingProjectWizard,
  runGreenfieldWizard,
  workspaceSkinConfigFromChoice,
} from "../utils/prompts.js";

/** Merge `workspaceSkin` into `.cursor/context/config.json` without wiping other keys. */
async function mergeWorkspaceSkinConfig(
  rootDir: string,
  workspaceSkin: WorkspaceSkinConfig,
): Promise<string> {
  const contextDir = path.join(rootDir, ".cursor", "context");
  const configPath = path.join(contextDir, "config.json");
  await ensureDir(contextDir);
  const existing = (await readJson<Record<string, unknown>>(configPath)) ?? {};
  await writeJson(configPath, { ...existing, workspaceSkin });
  return configPath;
}

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

    const { workspaceSkinChoice, ...profileToSave } = profile;
    const configPath = path.join(scan.rootDir, ".cursor", "agent-kit.config.json");
    await writeJson(configPath, profileToSave);
    logger.success(`Profile saved in ${configPath}`);

    const skinConfig =
      workspaceSkinChoice !== undefined ? workspaceSkinConfigFromChoice(workspaceSkinChoice) : null;
    if (skinConfig) {
      const contextConfigPath = await mergeWorkspaceSkinConfig(scan.rootDir, skinConfig);
      logger.success(`Workspace skin saved in ${contextConfigPath}`);
    }

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
