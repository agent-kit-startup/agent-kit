import { defineCommand } from "citty";
import { buildManifest, saveManifest } from "../lifecycle/apply.js";
import {
  checkForUpdates,
  compareSemver,
  normalizeSemver,
  readLocalKitVersion,
} from "../lifecycle/check-updates.js";
import { seedManagedHashLedger } from "../lifecycle/overlay.js";
import { syncPathCliToRuntime } from "../lifecycle/path-cli.js";
import { logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { syncFromManifest } from "../lifecycle/sync.js";
import { KIT_PACKAGE_SPEC, KIT_VERSION } from "../lifecycle/version.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { logger } from "../utils/logger.js";
import { RootRefusedError, confirmProjectRoot, isNonInteractive } from "../utils/terminal.js";
import { withCliProgress } from "../welcome/visual-kit.js";

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
        "Check-only: compare installed version to the resolved registry (public tags, or --registry local checkout); never apply L0 writes",
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
    "allow-stale-cli": {
      type: "boolean",
      description:
        "Apply even when this CLI is older than the registry it is syncing from; the manifest is then stamped with this CLI's version, not the registry's (factory/dev only)",
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
        registryPath:
          typeof args.registry === "string" && args.registry ? args.registry : undefined,
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
        if (err.recovery) console.error(`\n${err.recovery}\n`);
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

      // The manifest version below is this binary's KIT_VERSION, so an apply
      // can never deliver a version newer than the CLI running it. Refuse
      // rather than write a capped manifest and report success -- that is the
      // shape that makes an operator re-run `update` expecting a bump. The
      // guard is deliberately not lifted by --yes: non-interactive and hook
      // paths are exactly where a silent capped write does the most damage.
      const registryVersionRaw = await readLocalKitVersion(registry.root);
      const registryVersion = registryVersionRaw ? normalizeSemver(registryVersionRaw) : null;
      const cliVersion = normalizeSemver(KIT_VERSION);
      if (!registryVersion) {
        // Not every registry checkout carries a package.json; that is not a
        // reason to block an apply.
        logger.warn(
          "Could not read a version from the registry checkout - skipping the CLI freshness check.",
        );
      } else if (
        cliVersion &&
        compareSemver(cliVersion, registryVersion) < 0 &&
        !args["allow-stale-cli"]
      ) {
        logger.error(
          `This CLI is v${cliVersion}, older than the registry it would apply (v${registryVersion}).`,
        );
        console.error(
          [
            "",
            "`agent-kit update` syncs registry content but stamps .cursor/agent-kit.json with the",
            `version of the CLI running it, so applying now would write v${cliVersion} again, not v${registryVersion}.`,
            "",
            "Upgrade the binary first, then re-run:",
            `  npm i -g ${KIT_PACKAGE_SPEC}@${registryVersion}`,
            "  agent-kit update",
            "",
            `If npm has no ${registryVersion} yet, the release is still mid-publish`,
            "(content sync and npm publish run in parallel) - retry shortly.",
            "",
            "Factory/dev checkouts that intend to apply newer content with an older",
            "binary can pass --allow-stale-cli.",
            "",
          ].join("\n"),
        );
        process.exitCode = 1;
        return;
      }

      const next = buildManifest({
        version: KIT_VERSION,
        profile: existing.profile,
        packs: existing.packs,
        skills: existing.skills,
        protected: existing.protected,
        // Restamp generatorVersion with the CLI that ran this apply so the two
        // version fields in the manifest stop disagreeing after an update. The
        // personalization result file itself is not regenerated here.
        personalization: existing.personalization
          ? { ...existing.personalization, generatorVersion: KIT_VERSION }
          : undefined,
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
      const stats = await withCliProgress("update", () =>
        syncFromManifest(registry.root, projectRoot, next),
      );
      await saveManifest(projectRoot, next);
      logApplyStats(stats);
      // State the version actually written: a run that changes no version is a
      // legitimate outcome, but it must not read the same as one that bumps.
      const transition =
        next.version === existing.version
          ? `unchanged at v${next.version}`
          : `v${existing.version} → v${next.version}`;
      logger.success(`Update complete: ${transition} (L3 protected paths left untouched).`);
      const sync = await syncPathCliToRuntime({ runtimeVersion: KIT_VERSION });
      for (const line of sync.lines) console.log(line);
    } finally {
      await registry.unlock?.();
    }
  },
});
