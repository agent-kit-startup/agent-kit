import { defineCommand } from "citty";
import { buildManifest, saveManifest } from "../lifecycle/apply.js";
import { checkForUpdates } from "../lifecycle/check-updates.js";
import { seedManagedHashLedger } from "../lifecycle/overlay.js";
import { logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { syncFromManifest } from "../lifecycle/sync.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { logger } from "../utils/logger.js";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description:
      "Re-apply L0/packs/skills from the registry; never overwrites L3 protected paths. Use --check for notify-only.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    check: {
      type: "boolean",
      description:
        "Check-only: compare installed version to latest public tag; never apply L0 writes",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print machine-readable JSON (with --check)",
      default: false,
    },
    "respect-prefs": {
      type: "boolean",
      description:
        "Honor updateCheck.enabled and intervalDays from .cursor/context/config.json (hooks)",
      default: false,
    },
    stamp: {
      type: "boolean",
      description: "Persist updateCheck.lastCheckedAt after a network check",
      default: false,
    },
    "seed-overlay": {
      type: "boolean",
      description:
        "Seed the managed-hash ledger from current local overlay files before applying (factory/dogfood only; consumers should not use this)",
      default: false,
    },
    ...REGISTRY_CLI_ARGS,
  },
  async run({ args }) {
    if (args.check) {
      const result = await checkForUpdates(args.cwd, {
        respectPrefs: Boolean(args["respect-prefs"]),
        stamp: Boolean(args.stamp),
        publicRegistryUrl: typeof args.url === "string" && args.url ? args.url : undefined,
      });

      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const line = `[${result.status}] ${result.message}`;
        if (result.status === "error") logger.error(line);
        else if (result.status === "update-available") logger.warn(line);
        else if (result.status.startsWith("skipped-")) logger.warn(line);
        else logger.info(line);
      }

      // Exit 0 always for successful check semantics; status is in payload.
      // Non-zero only on hard check errors so hooks can distinguish fetch failures.
      if (result.status === "error") process.exitCode = 2;
      return;
    }

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
      personalization: existing.personalization,
      registryUrl: registry.url ?? existing.registry?.url,
      registryRef: registry.ref ?? existing.registry?.ref,
    });
    // Preserve optional metadata from existing manifest
    if (existing.overrides?.length) next.overrides = existing.overrides;
    if (next.version === existing.version && existing.installedAt) {
      next.installedAt = existing.installedAt;
    }

    if (args["seed-overlay"]) {
      await seedManagedHashLedger(args.cwd);
      logger.info("Seeded managed-hash ledger from current local overlay files.");
    }
    const stats = await syncFromManifest(registry.root, args.cwd, next);
    await saveManifest(args.cwd, next);
    logApplyStats(stats);
    logger.success("Update complete (L3 protected paths left untouched).");
  },
});
