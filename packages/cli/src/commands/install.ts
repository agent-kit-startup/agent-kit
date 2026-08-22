import path from "node:path";
import { defineCommand } from "citty";
import { bold, cyan, green, options as koloristOptions } from "kolorist";
import { applyPersonalization, readRepositoryProfile } from "../generator/personalization.js";
import { type ApplyStats, buildManifest, saveManifest } from "../lifecycle/apply.js";
import { resolveProtectedGlobs } from "../lifecycle/protected.js";
import { logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { installL0, syncFromManifest } from "../lifecycle/sync.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { DOMAIN_PACK_IDS, loadAgentKitManifest } from "../manifest/index.js";
import { type EnvironmentReport, assessEnvironment } from "../readiness/env-checks.js";
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
import { shouldUseWelcomeColor, withCliProgress } from "../welcome/visual-kit.js";

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
  /**
   * Opt-in: generate .claude/commands/*.md thin pointer adapters and merge
   * a SessionStart context hook into .claude/settings.json (default false).
   */
  claudeAdapters?: boolean;
}

export interface InstallResult {
  projectRoot: string;
  manifestPath: string;
  stats: ApplyStats;
  readiness: ReadinessReport;
  safeChanges: SafeReadinessChange[];
  /** Set only when --claude was requested and .claude/settings.json could not be merged (see personalization.ts). */
  claudeSessionStartInstructions?: string;
}

export function nextStepAfterInstall(pendingActions: number): string {
  return pendingActions > 0
    ? "Next: run /agent-kit-onboard in Cursor to resolve the first pending action."
    : "Next: run /start-project in Cursor when you have a deliverable.";
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
  console.log(nextStepAfterInstall(pendingActions.length));
}

export interface InstallEpilogueOptions {
  /** Force color on/off; when omitted, derive from shouldUseWelcomeColor(). */
  color?: boolean;
  /** Injectable sink for tests; defaults to console.log. */
  print?: (line: string) => void;
}

/**
 * Apply a kolorist paint fn, forcing both `enabled` and `supportLevel` for the
 * call. kolorist auto-detects `supportLevel` from stdout/TERM at import time
 * and stays at "none" for non-TTY stdout (piped output, most test runners) -
 * forcing only `enabled` (as elsewhere) still no-ops there. Once our own
 * color gate (`shouldUseWelcomeColor`) has said yes, painting should not be
 * silently dropped by a second, independent detector.
 */
function paint(fn: (s: string | number) => string, text: string): string {
  const prevEnabled = koloristOptions.enabled;
  const prevSupportLevel = koloristOptions.supportLevel;
  koloristOptions.enabled = true;
  koloristOptions.supportLevel = 3;
  try {
    return fn(text);
  } finally {
    koloristOptions.enabled = prevEnabled;
    koloristOptions.supportLevel = prevSupportLevel;
  }
}

/**
 * The post-install "what now" epilogue for the CLI invocation form.
 *
 * `npx` is ephemeral: right after `npx @dadado/agent-kit-cli install` a bare
 * `agent-kit` is not on PATH, so a beginner who tries one next hits
 * "command not found". This names that symptom up front and offers three
 * numbered choices (keep using npx / fix PATH via setup-global / manual
 * steps) instead of silently repeating the npx form.
 *
 * When `env.binOnPath` is already true (global install, or a machine where
 * the bin already resolves), the choices above are noise — this prints one
 * short positive line instead.
 */
export function printInstallEpilogue(
  env: EnvironmentReport,
  options: InstallEpilogueOptions = {},
): void {
  const print = options.print ?? ((line: string) => console.log(line));
  const color = options.color ?? shouldUseWelcomeColor();

  if (env.binOnPath) {
    const line = "`agent-kit` is on PATH — run it directly, e.g. `agent-kit doctor`.";
    print(color ? paint(green, line) : line);
    return;
  }

  const divider = "─".repeat(60);
  const body = [
    "You ran this through npx, so a bare `agent-kit` isn't on PATH yet.",
    'If you try `agent-kit <subcommand>` next, you will see "command not',
    'found". Pick one:',
    "",
    "  1. Keep using npx — works right now, no action needed",
    "     npx @dadado/agent-kit-cli <subcommand>",
    "",
    "  2. Put a bare `agent-kit` on PATH",
    "     npx @dadado/agent-kit-cli setup-global",
    "     (fixes a root-owned npm prefix if that's the blocker, or just installs)",
    "",
    "  3. Manual steps",
    "     See docs/getting-started.md (Troubleshooting npm failures), or:",
    "       mkdir -p ~/.npm-global",
    '       npm config set prefix "~/.npm-global"',
    '       export PATH="~/.npm-global/bin:$PATH"',
    "       npm i -g @dadado/agent-kit-cli",
  ];

  print(color ? paint(cyan, divider) : divider);
  const heading = "Heads up: a bare `agent-kit` command won't work yet";
  print(color ? paint(bold, paint(cyan, heading)) : heading);
  for (const line of body) print(line);
  print(color ? paint(cyan, divider) : divider);
}

async function printPostInstallSummary(result: InstallResult): Promise<void> {
  printReadinessNarrative(result);
  const env = await assessEnvironment();
  printInstallEpilogue(env);
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
    let claudeSessionStartInstructions: string | undefined;
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
        claudeAdapters: options.claudeAdapters,
      });
      await saveManifest(projectRoot, personalization.manifest);
      claudeSessionStartInstructions = personalization.result.claudeSessionStartInstructions;
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
      ...(claudeSessionStartInstructions ? { claudeSessionStartInstructions } : {}),
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
    claude: {
      type: "boolean",
      description:
        "Opt-in: generate .claude/commands/*.md thin pointer adapters for the installed .cursor/commands set, and merge a SessionStart context hook into .claude/settings.json (default install behavior is unchanged without this flag)",
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
        if (err.recovery) console.error(`\n${err.recovery}\n`);
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
          claudeAdapters: args.claude,
        }),
      );
      logApplyStats(result.stats);
      logger.success(`Manifest written: ${result.manifestPath}`);
      logger.success("Readiness snapshot written: .cursor/context/readiness.json");
      await printPostInstallSummary(result);
      if (result.claudeSessionStartInstructions) {
        logger.warn("Could not merge the Claude Code SessionStart hook automatically:");
        console.log(`\n${result.claudeSessionStartInstructions}\n`);
      }
    } catch (err) {
      const hint = classifyInstallError(err);
      logger.error(hint.message);
      console.error(`\n${hint.recovery}\n`);
      // exitCode + return (not process.exit): an immediate exit can truncate
      // the recovery hint when stderr is a pipe (CI/log capture), and it
      // matches the refusal path above and update.ts.
      process.exitCode = 1;
      return;
    }
  },
});
