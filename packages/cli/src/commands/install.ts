import path from "node:path";
import { defineCommand } from "citty";
import { applyPersonalization, readRepositoryProfile } from "../generator/personalization.js";
import { type ApplyStats, buildManifest, saveManifest } from "../lifecycle/apply.js";
import { resolveProtectedGlobs } from "../lifecycle/protected.js";
import { logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { installL0, syncFromManifest } from "../lifecycle/sync.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { DOMAIN_PACK_IDS, loadAgentKitManifest } from "../manifest/index.js";
import { loadRegistry } from "../registry/client.js";
import { createReadinessReport } from "../scanner/readiness.js";
import { executeSafeReadinessFixes } from "../scanner/safe-fixes.js";
import { runScanner } from "../scanner/scan.js";
import { writeReadinessSnapshot } from "../scanner/snapshot.js";
import type { ReadinessReport, SafeReadinessChange } from "../types.js";
import { logger } from "../utils/logger.js";
import {
  RootRefusedError,
  classifyInstallError,
  confirmProjectRoot,
  isNonInteractive,
} from "../utils/terminal.js";
import { withCliProgress } from "../welcome/visual-kit.js";

function parsePackList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

interface InstallOptions {
  cwd: string;
  profile?: string;
  pack?: string;
  registry?: string;
  url?: string;
  ref?: string;
  refresh?: boolean;
}

export interface InstallResult {
  projectRoot: string;
  manifestPath: string;
  stats: ApplyStats;
  readiness: ReadinessReport;
  safeChanges: SafeReadinessChange[];
}

function printReadinessNarrative(result: InstallResult): void {
  const { summary, pendingActions } = result.readiness;
  const fixed = result.safeChanges.filter((change) => change.status === "applied").length;
  console.log("\nRepository readiness");
  console.log(
    `  ready: ${summary.ready}, choices: ${summary.needs_choice}, manual: ${summary.manual}, blocked: ${summary.blocked}`,
  );
  console.log(`  safe fixes applied: ${fixed}`);
  console.log(`  pending actions: ${pendingActions.length}`);
  console.log(
    pendingActions.length > 0
      ? "Next: run /agent-kit-onboard in Cursor to resolve the first pending action"
      : "Next: run /start-project in Cursor when you have a deliverable",
  );
}

export async function performInstall(options: InstallOptions): Promise<InstallResult> {
  const projectRoot = path.resolve(options.cwd);
  const packs = parsePackList(options.pack);
  const existing = await loadAgentKitManifest(projectRoot);
  const registry = await resolveRegistryFromCli({
    cwd: projectRoot,
    registry: options.registry,
    url: options.url,
    ref: options.ref,
    refresh: options.refresh,
    manifest: existing,
  });
  try {
    const draft = buildManifest({
      version: KIT_VERSION,
      profile: options.profile ?? existing?.profile ?? "default",
      packs: packs.length > 0 ? packs : existing?.packs,
      skills: existing?.skills,
      protected: existing?.protected,
      personalization: existing?.personalization,
      registryUrl: registry.url ?? existing?.registry?.url,
      registryRef: registry.ref ?? existing?.registry?.ref,
    });

    const stats =
      (draft.packs?.length ?? 0) > 0 || (draft.skills?.length ?? 0) > 0
        ? await syncFromManifest(registry.root, projectRoot, draft)
        : await installL0(registry.root, projectRoot, resolveProtectedGlobs(draft));
    const manifestPath = await saveManifest(projectRoot, draft);
    const readinessExecution = await executeSafeReadinessFixes(projectRoot, {
      generatorVersion: KIT_VERSION,
    });
    let readiness = readinessExecution.after;
    const profile = await readRepositoryProfile(projectRoot);
    if (profile) {
      const registryIndex = await loadRegistry(registry.root);
      const personalization = await applyPersonalization({
        rootDir: projectRoot,
        registryRoot: registry.root,
        profile,
        report: readinessExecution.after,
        registry: registryIndex,
        manifest: draft,
        generatorVersion: KIT_VERSION,
      });
      await saveManifest(projectRoot, personalization.manifest);
      readiness = createReadinessReport(await runScanner(projectRoot), {
        generatorVersion: KIT_VERSION,
      });
      readiness.appliedSafeFixes = readinessExecution.after.appliedSafeFixes;
    }
    await writeReadinessSnapshot(projectRoot, readiness);

    return {
      projectRoot,
      manifestPath,
      stats,
      readiness,
      safeChanges: readinessExecution.changes,
    };
  } finally {
    await registry.unlock?.();
  }
}

export const installCommand = defineCommand({
  meta: {
    name: "install",
    description: "Bootstrap L0 (+ optional packs) and write .cursor/agent-kit.json.",
  },
  args: {
    profile: {
      type: "positional",
      description: "Install profile name stored in the manifest (default: default)",
      required: false,
    },
    pack: {
      type: "string",
      description: `Comma-separated L1 pack ids (e.g. cybersec,devops). Known: ${DOMAIN_PACK_IDS.join(", ")}`,
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
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    ...REGISTRY_CLI_ARGS,
  },
  async run({ args }) {
    const nonInteractive = args.yes || isNonInteractive();
    if (nonInteractive) {
      logger.info("Non-interactive mode: skipping prompts, using defaults.");
    }

    let projectRoot: string;
    try {
      projectRoot = await confirmProjectRoot(args.cwd, {
        nonInteractive,
        command: "install",
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
    logger.info(`Installing into: ${projectRoot}`);

    const packs = parsePackList(args.pack);
    for (const id of packs) {
      if (!DOMAIN_PACK_IDS.includes(id as (typeof DOMAIN_PACK_IDS)[number])) {
        logger.warn(`Pack '${id}' is not in the known L1 list; will still try registry.`);
      }
    }

    try {
      const result = await withCliProgress("install", () =>
        performInstall({
          cwd: projectRoot,
          profile: args.profile as string | undefined,
          pack: args.pack,
          registry: args.registry,
          url: args.url,
          ref: args.ref,
          refresh: args.refresh,
        }),
      );
      logApplyStats(result.stats);
      logger.success(`Manifest written: ${result.manifestPath}`);
      logger.success("Readiness snapshot written: .cursor/context/readiness.json");
      printReadinessNarrative(result);
    } catch (err) {
      const hint = classifyInstallError(err);
      logger.error(hint.message);
      console.error(`\n${hint.recovery}\n`);
      process.exit(1);
    }
  },
});
