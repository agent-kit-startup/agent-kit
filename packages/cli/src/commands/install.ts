import path from "node:path";
import { defineCommand } from "citty";
import { type ApplyStats, buildManifest, saveManifest } from "../lifecycle/apply.js";
import { resolveProtectedGlobs } from "../lifecycle/protected.js";
import { logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { installL0, syncFromManifest } from "../lifecycle/sync.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { DOMAIN_PACK_IDS, loadAgentKitManifest } from "../manifest/index.js";
import { logger } from "../utils/logger.js";

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

function printInstallNextSteps(projectRoot: string): void {
  console.log("\nNext:");
  console.log(`  Open this folder in Cursor: ${projectRoot}`);
  console.log("  Run /start-project in chat");
  console.log("  Optional: agent-kit status");
}

export const installCommand = defineCommand({
  meta: {
    name: "install",
    description: "Bootstrap L0 (+ optional packs) from the registry and write agent-kit.json.",
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
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    ...REGISTRY_CLI_ARGS,
  },
  async run({ args }) {
    const projectRoot = path.resolve(args.cwd);
    logger.info(`Installing into: ${projectRoot}`);

    const packs = parsePackList(args.pack);
    for (const id of packs) {
      if (!DOMAIN_PACK_IDS.includes(id as (typeof DOMAIN_PACK_IDS)[number])) {
        logger.warn(`Pack '${id}' is not in the known L1 list — will still try registry.`);
      }
    }

    const existing = await loadAgentKitManifest(projectRoot);
    const registry = await resolveRegistryFromCli({
      cwd: projectRoot,
      registry: args.registry,
      url: args.url,
      ref: args.ref,
      refresh: args.refresh,
      manifest: existing,
    });

    logger.info(`Registry: ${registry.root} (${registry.source})`);

    const draft = buildManifest({
      version: KIT_VERSION,
      profile: (args.profile as string | undefined) ?? existing?.profile ?? "default",
      packs: packs.length > 0 ? packs : existing?.packs,
      skills: existing?.skills,
      protected: existing?.protected,
      registryUrl: registry.url ?? existing?.registry?.url,
      registryRef: registry.ref ?? existing?.registry?.ref,
    });

    let stats: ApplyStats;
    if ((draft.packs?.length ?? 0) > 0 || (draft.skills?.length ?? 0) > 0) {
      stats = await syncFromManifest(registry.root, projectRoot, draft);
    } else {
      const protectedGlobs = resolveProtectedGlobs(draft);
      stats = await installL0(registry.root, projectRoot, protectedGlobs);
    }

    const manifestPath = await saveManifest(projectRoot, draft);
    logApplyStats(stats);
    logger.success(`Manifest written: ${manifestPath}`);
    printInstallNextSteps(projectRoot);
  },
});
