import { defineCommand } from "citty";
import { buildManifest, saveManifest } from "../lifecycle/apply.js";
import { logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { syncFromManifest } from "../lifecycle/sync.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { logger } from "../utils/logger.js";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Re-apply L0/packs/skills from the registry; never overwrites L3 protected paths.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    ...REGISTRY_CLI_ARGS,
  },
  async run({ args }) {
    const existing = await loadAgentKitManifest(args.cwd);
    if (!existing) {
      logger.warn("No .cursor/agent-kit.json — run agent-kit install first.");
      return;
    }

    const registry = await resolveRegistryFromCli({
      cwd: args.cwd,
      registry: args.registry,
      url: args.url,
      ref: args.ref,
      refresh: args.refresh,
      manifest: existing,
    });

    logger.info(`Registry: ${registry.root} (${registry.source})`);

    const next = buildManifest({
      version: KIT_VERSION,
      profile: existing.profile,
      packs: existing.packs,
      skills: existing.skills,
      protected: existing.protected,
      registryUrl: registry.url ?? existing.registry?.url,
      registryRef: registry.ref ?? existing.registry?.ref,
    });
    // Preserve overrides from existing manifest
    if (existing.overrides?.length) next.overrides = existing.overrides;

    const stats = await syncFromManifest(registry.root, args.cwd, next);
    await saveManifest(args.cwd, next);
    logApplyStats(stats);
    logger.success("Update complete (L3 protected paths left untouched).");
  },
});
