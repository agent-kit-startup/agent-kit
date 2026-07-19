import { defineCommand } from "citty";
import {
  formatPrBody,
  planContribute,
  writeContributeToRegistry,
} from "../lifecycle/contribute.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { logger } from "../utils/logger.js";

function parsePaths(raw: string | undefined): string[] {
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

export const contributeCommand = defineCommand({
  meta: {
    name: "contribute",
    description:
      "Propose upstream changes: detect local drift/new kit artifacts, run anti-slop gate, optionally write into a kit checkout for a PR.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    path: {
      type: "string",
      description: "Comma-separated project-relative paths to contribute (new or edited)",
    },
    drift: {
      type: "boolean",
      description: "Include drifted installed L0/pack/skill files vs registry (default: true)",
      default: true,
    },
    write: {
      type: "boolean",
      description:
        "Copy accepted files into the local kit/registry checkout (--registry required / resolved)",
      default: false,
    },
    ...REGISTRY_CLI_ARGS,
  },
  async run({ args }) {
    const manifest = await loadAgentKitManifest(args.cwd);
    if (!manifest) {
      logger.warn("No .cursor/agent-kit.json — run agent-kit install first.");
      return;
    }

    const registry = await resolveRegistryFromCli({
      cwd: args.cwd,
      registry: args.registry,
      url: args.url,
      ref: args.ref,
      refresh: args.refresh,
      manifest,
    });

    if (registry.source !== "flag" && args.write) {
      logger.warn(
        "contribute --write needs a local kit checkout. Pass --registry /path/to/agent-kit.",
      );
      return;
    }

    logger.info(`Registry: ${registry.root} (${registry.source})`);

    const plan = await planContribute({
      registryRoot: registry.root,
      projectRoot: args.cwd,
      manifest,
      extraPaths: parsePaths(args.path),
      includeDrift: args.drift,
    });

    console.log(
      `Contribute plan: accepted=${plan.accepted.length} rejected=${plan.rejected.length} (drift scan=${args.drift})`,
    );

    if (plan.candidates.length === 0) {
      logger.success("Nothing to contribute (no drift / no --path).");
      return;
    }

    for (const c of plan.candidates) {
      const mark = c.gateOk ? "ok" : "FAIL";
      console.log(
        `${mark.padEnd(4)} ${c.kind.padEnd(5)} ${c.projectPath} → ${c.registryPath || "(unmapped)"}`,
      );
      for (const issue of c.issues) {
        console.log(`       [${issue.code}] ${issue.message}`);
      }
    }

    if (plan.accepted.length === 0) {
      logger.warn("No files passed the contribute gate.");
      return;
    }

    console.log("\n--- Suggested PR body ---\n");
    console.log(formatPrBody(plan.accepted));

    if (!args.write) {
      logger.info(
        "Dry run. Re-run with --write --registry /path/to/agent-kit to copy accepted files into the kit checkout, then open a PR (gh pr create --base main).",
      );
      return;
    }

    const written = await writeContributeToRegistry(args.cwd, registry.root, plan.accepted);
    logger.success(`Wrote ${written.length} file(s) into ${registry.root}`);
    for (const p of written) console.log(`  + ${p}`);
    console.log("\nNext (HITL — review before push):");
    console.log(`  cd ${registry.root}`);
    console.log("  git checkout -b contribute/<short-topic>");
    console.log('  git add <files> && git commit -m "feat: contribute <topic> from consumer"');
    console.log("  git push -u origin HEAD");
    console.log('  gh pr create --base main --title "feat: contribute <topic>" --body-file -');
  },
});
