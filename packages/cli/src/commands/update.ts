import { defineCommand } from "citty";
import {
  type ClaudeCommandAdapterResult,
  generateClaudeCommandAdapters,
} from "../generator/claude-command-adapters.js";
import {
  CLAUDE_SETTINGS_REL,
  formatClaudeSettingsDrift,
  formatPermissionsChanged,
  planClaudeSettingsDrift,
  writeClaudeSessionStartHook,
} from "../generator/claude-session-start-hook.js";
import { feedInstallsRegistry } from "../installs/index.js";
import { type ApplyStats, buildManifest, saveManifest } from "../lifecycle/apply.js";
import { checkForUpdates } from "../lifecycle/check-updates.js";
import { seedManagedHashLedger } from "../lifecycle/overlay.js";
import { syncPathCliToRuntime } from "../lifecycle/path-cli.js";
import { isProtectedPath, resolveProtectedGlobs } from "../lifecycle/protected.js";
import { formatSkippedSymlinks, logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { dropRetiredSkillIds, formatRetiredSkillDrop } from "../lifecycle/retired.js";
import { detectStaleCli, formatRerunFlags, formatStaleCliRefusal } from "../lifecycle/stale-cli.js";
import { syncFromManifest } from "../lifecycle/sync.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { formatQueueLeaseRefusal, inspectQueueLease } from "../plan-loop/queue-lease.js";
import { canonicalizePackIds } from "../registry/client.js";
import { formatPackIdRewrite } from "../registry/pack-aliases.js";
import { logger } from "../utils/logger.js";
import { confirmProjectRoot, isNonInteractive, RootRefusedError } from "../utils/terminal.js";
import { withCliProgress } from "../welcome/visual-kit.js";
import { NON_INTERACTIVE_ROOT_ARGS } from "./shared-args.js";

/** Flags a stale-CLI refusal repeats in its re-run line, in this order. */
const UPDATE_RERUN_FLAGS = [
  "claude",
  "yes",
  "force-root",
  "force",
  "seed-overlay",
  "cwd",
  "registry",
  "url",
  "ref",
  "refresh",
] as const;

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
    force: {
      type: "boolean",
      description:
        "Apply even while another live writer holds the queue lease (.cursor/context/run-plan-all.lock); an operator choice, never a default",
      default: false,
    },
    claude: {
      type: "boolean",
      description:
        "Also apply the ledger-aware Claude settings merge (.claude/settings.json + ledger) and generate the .claude/commands/* pointer adapters with install --claude authority; operator opt-in, never from hooks or plan-loop",
      default: false,
    },
    all: {
      type: "boolean",
      description:
        "Operator-typed only: update every repo in the machine install registry, one branch chore/kit-X.Y.Z and one PR/MR per repo after one plan table and one confirm; refuses without a TTY or inside an agent session; never merges",
      default: false,
    },
    "include-worktrees": {
      type: "boolean",
      description: "With --all: also update linked git worktrees (excluded by default)",
      default: false,
    },
    ...NON_INTERACTIVE_ROOT_ARGS,
    ...REGISTRY_CLI_ARGS,
  },
  async run({ args }) {
    if (args.all) {
      if (args.check) {
        logger.error(
          "--all and --check do not combine; use agent-kit installs list to see versions.",
        );
        process.exitCode = 1;
        return;
      }
      // Lazy: update-all imports applyUpdateAtRoot from this module.
      const { runUpdateAll } = await import("./update-all.js");
      const result = await runUpdateAll({
        includeWorktrees: args["include-worktrees"],
        applyOptions: {
          registry: args.registry,
          url: args.url,
          ref: args.ref,
          refresh: args.refresh,
        },
      });
      const failed = result.results.some((r) => r.outcome.status === "error");
      if (result.status === "refused" || result.status === "preflight-stop" || failed) {
        process.exitCode = 1;
      }
      return;
    }
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

    const result = await applyUpdateAtRoot(projectRoot, {
      registry: args.registry,
      url: args.url,
      ref: args.ref,
      refresh: args.refresh,
      force: args.force,
      allowStaleCli: args["allow-stale-cli"],
      seedOverlay: args["seed-overlay"],
      claude: args.claude,
      rerun: formatRerunFlags(args, UPDATE_RERUN_FLAGS),
      syncPathCli: true,
    });
    if (result.status === "refused" || result.status === "failed") process.exitCode = 1;
  },
});

export interface ApplyUpdateOptions {
  registry?: string;
  url?: string;
  ref?: string;
  refresh?: boolean;
  /** Apply even while another live writer holds the queue lease (operator choice). */
  force?: boolean;
  allowStaleCli?: boolean;
  seedOverlay?: boolean;
  claude?: boolean;
  /** Flags repeated in a stale-CLI refusal's re-run line. */
  rerun?: string;
  /** Sync the PATH CLI to this runtime after the apply (single-repo update only). */
  syncPathCli?: boolean;
}

export type ApplyUpdateResult =
  | { status: "applied"; fromVersion: string; toVersion: string; stats: ApplyStats }
  | { status: "no-manifest" }
  /** Lease held or stale CLI: nothing was written. */
  | { status: "refused"; reason: string }
  /** Partial apply (symlink outside the project): the manifest was not stamped. */
  | { status: "failed"; reason: string };

/**
 * The update apply for one confirmed absolute project root. Logs the same
 * lines as `agent-kit update` and returns the outcome instead of setting
 * `process.exitCode`, so `update --all` can run it per repository. It never
 * prompts and never confirms the root: callers do that first.
 */
export async function applyUpdateAtRoot(
  projectRoot: string,
  options: ApplyUpdateOptions = {},
): Promise<ApplyUpdateResult> {
  const existing = await loadAgentKitManifest(projectRoot, { onWarning: logger.warn });
  if (!existing) {
    logger.warn("No .cursor/agent-kit.json — run agent-kit install first.");
    return { status: "no-manifest" };
  }

  // Live-writer check (ADR 2026-07-26 Amend 2026-11-16): another session
  // holding the queue lease may be reading or writing L0 right now. Same
  // verdict as `agent-kit queue lease`; free, stale and own session proceed.
  const lease = inspectQueueLease(projectRoot);
  if (lease.kind === "held" && !options.force) {
    const reason = formatQueueLeaseRefusal(lease, {
      what: "another live session writes this workspace, so update will not rewrite L0",
      next: "run agent-kit update again (--force applies anyway; operator choice)",
    });
    logger.error(reason);
    return { status: "refused", reason };
  }

  const registry = await resolveRegistryFromCli({
    cwd: projectRoot,
    registry: options.registry,
    url: options.url,
    ref: options.ref,
    refresh: options.refresh,
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
    const stale = await detectStaleCli(registry.root, { warn: logger.warn });
    if (stale && !options.allowStaleCli) {
      const refusal = formatStaleCliRefusal({
        command: "update",
        stale,
        rerun: options.rerun ?? "",
      });
      logger.error(refusal.error);
      console.error(refusal.recovery);
      return { status: "refused", reason: refusal.error };
    }

    // Legacy pack ids (ADR 2026-07-19_l1-pack-ids-english) are rewritten to
    // the id the registry ships; unknown ids stay and sync warns about them.
    const packIds = await canonicalizePackIds(registry.root, existing.packs);
    // Skills the registry retired (ADR 2026-11-26 third-party skill license policy).
    const retiredSkills = dropRetiredSkillIds(existing.skills);
    const next = buildManifest({
      version: KIT_VERSION,
      profile: existing.profile,
      packs: packIds.packs,
      skills: retiredSkills.skills,
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
    if (existing.unknownFields) next.unknownFields = existing.unknownFields;
    if (next.version === existing.version && existing.installedAt) {
      next.installedAt = existing.installedAt;
    }

    if (options.seedOverlay) {
      await seedManagedHashLedger(projectRoot);
      logger.info("Seeded managed-hash ledger from current local overlay files.");
    }
    const stats = await withCliProgress("update", () =>
      syncFromManifest(registry.root, projectRoot, next),
    );
    if (stats.skippedSymlink.length > 0) {
      // Some kit content did not land; stamping the new version would claim
      // it did. Keep the manifest as-is and fail loudly.
      logApplyStats(stats);
      const reason = formatSkippedSymlinks(stats.skippedSymlink);
      logger.error(reason);
      return { status: "failed", reason };
    }
    if (options.claude) {
      // Scoped opt-in: install --claude authority over settings.json + ledger only.
      // manifest.protected is never edited.
      const claude = await writeClaudeSessionStartHook(projectRoot, { authorized: true });
      if (claude.status === "skipped-symlink") {
        logApplyStats(stats);
        const reason = `Claude settings not written: ${CLAUDE_SETTINGS_REL}, .claude/ or the ledger resolves outside the project (symlink). Nothing was changed there.`;
        logger.error(reason);
        return { status: "failed", reason };
      }
      if (claude.status === "unavailable") {
        logger.warn(claude.instructions ?? `${CLAUDE_SETTINGS_REL} could not be merged.`);
      } else {
        console.log(`Claude settings ${claude.status}: ${claude.relativePath}`);
        const changed = formatPermissionsChanged(claude.permissionChanges ?? [], {
          mergeAllowWithoutGuard: claude.mergeAllowWithoutGuard ?? [],
        });
        for (const line of changed) console.log(line);
      }
      // Adopt the command adapters without reapplying L0: writes only
      // .claude/commands/* (plus the shared managed-hash ledger), overlay-safe.
      const adapters = await generateClaudeCommandAdapters(projectRoot);
      const skipped = adapters.filter((a) => a.status === "skipped-symlink");
      if (skipped.length > 0) {
        logApplyStats(stats);
        const reason = `Claude command adapters not written for: ${skipped.map((a) => a.relativePath).join(", ")} (symlink outside the project). Nothing was changed there.`;
        logger.error(reason);
        return { status: "failed", reason };
      }
      if (adapters.length > 0) console.log(formatClaudeAdapterSummary(adapters));
    } else {
      // Report-only: never writes settings.json or the ledger (`--claude` is the opt-in).
      const drift = await planClaudeSettingsDrift(projectRoot);
      if (drift) {
        const protectedPath = isProtectedPath(CLAUDE_SETTINGS_REL, resolveProtectedGlobs(next));
        for (const line of formatClaudeSettingsDrift(drift, { protectedPath })) console.log(line);
      }
    }
    await saveManifest(projectRoot, next);
    for (const rewrite of packIds.rewrites) logger.info(formatPackIdRewrite(rewrite));
    for (const id of retiredSkills.dropped) logger.info(formatRetiredSkillDrop(id));
    logApplyStats(stats);
    // State the version actually written: a run that changes no version is a
    // legitimate outcome, but it must not read the same as one that bumps.
    const transition =
      next.version === existing.version
        ? `unchanged at v${next.version}`
        : `v${existing.version} → v${next.version}`;
    logger.success(`Update complete: ${transition} (L3 protected paths left untouched).`);
    await feedInstallsRegistry(projectRoot);
    if (options.syncPathCli) {
      const sync = await syncPathCliToRuntime({ runtimeVersion: KIT_VERSION });
      for (const line of sync.lines) console.log(line);
    }
    return { status: "applied", fromVersion: existing.version, toVersion: next.version, stats };
  } finally {
    await registry.unlock?.();
  }
}

function formatClaudeAdapterSummary(results: ClaudeCommandAdapterResult[]): string {
  const count = (status: ClaudeCommandAdapterResult["status"]) =>
    results.filter((r) => r.status === status).length;
  const parts = [
    `${count("applied")} written`,
    `${count("refreshed")} refreshed`,
    `${count("unchanged")} unchanged`,
  ];
  const customized = count("preserved-customized");
  if (customized > 0) parts.push(`${customized} preserved (customized)`);
  return `Claude command adapters: ${parts.join(", ")} (.claude/commands/)`;
}
