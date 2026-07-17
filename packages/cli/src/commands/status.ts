import path from "node:path";
import { defineCommand } from "citty";
import { resolveProtectedGlobs } from "../lifecycle/protected.js";
import { MANIFEST_RELATIVE_PATH, loadAgentKitManifest } from "../manifest/index.js";
import type { ProjectProfile } from "../types.js";
import { readJson } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show Agent Kit distribution status (manifest + optional wizard profile).",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    json: {
      type: "boolean",
      description: "Print raw JSON for manifest and profile",
      default: false,
    },
  },
  async run({ args }) {
    const manifest = await loadAgentKitManifest(args.cwd);
    const profilePath = path.join(args.cwd, ".cursor", "agent-kit.config.json");
    const profile = await readJson<ProjectProfile>(profilePath);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            manifest: manifest ?? null,
            profile: profile ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!manifest) {
      logger.warn(`No ${MANIFEST_RELATIVE_PATH} — run agent-kit install.`);
    } else {
      const protectedGlobs = resolveProtectedGlobs(manifest);
      console.log("Agent Kit status");
      console.log(`  version:    ${manifest.version}`);
      console.log(`  profile:    ${manifest.profile ?? "(none)"}`);
      console.log(`  packs:      ${(manifest.packs ?? []).join(", ") || "(none)"}`);
      console.log(`  skills:     ${(manifest.skills ?? []).length} listed`);
      console.log(`  protected:  ${protectedGlobs.length} glob(s) (L3 safe on update)`);
      console.log(
        `  registry:   ${manifest.registry?.url ?? "(default)"} @ ${manifest.registry?.ref ?? "(default)"}`,
      );
      if (manifest.installedAt) console.log(`  installed:  ${manifest.installedAt}`);
    }

    if (profile) {
      console.log("Wizard profile (agent-kit.config.json): present");
      console.log(`  IDE:        ${profile.ide?.ide ?? "?"}`);
      console.log(`  core picks: ${(profile.selectedCoreComponents ?? []).join(", ") || "(none)"}`);
    } else {
      logger.info("No wizard profile — optional; run agent-kit init for generators.");
    }
  },
});
