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
import { RootRefusedError, confirmProjectRoot, isNonInteractive } from "../utils/terminal.js";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description:
      "Re-apply L0/packs/skills from the registry (never overwrites L3). --check = notify-only.",
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

    const nonInteractive = args.yes || isNonInteractive();
    let projectRoot: string;
    try {
      projectRoot = await confirmProjectRoot(args.cwd, {
        nonInteractive,
        command: "update",
        forceRoot: args["force-root"],
      });
    } catch (err) {
      if (err instanceof RootRefusedError) {
        logger.error(err.message);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    const existing = await loadAgentKitManifest(projectRoot);
    if (!existing) {
      logger.warn("No .cursor/agent-kit.json — run agent-kit install first.");
      return;
    }

    const registry = await resolveRegistryFromCli({
      cwd: projectRoot,
      registry: args.registry,
      url: args.url,
      ref: args.ref,
      refresh: args.refresh,
      manifest: existing,
    });
    try {
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
        await seedManagedHashLedger(projectRoot);
        logger.info("Seeded managed-hash ledger from current local overlay files.");
      }
      const stats = await syncFromManifest(registry.root, projectRoot, next);
      await saveManifest(projectRoot, next);
      logApplyStats(stats);
      logger.success("Update complete (L3 protected paths left untouched).");
    } finally {
      await registry.unlock?.();
    }
  },
});
