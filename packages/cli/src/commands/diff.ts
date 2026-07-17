import { defineCommand } from "citty";
import { diffAgainstRegistry, summarizeDiff } from "../lifecycle/diff.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { logger } from "../utils/logger.js";

export const diffCommand = defineCommand({
  meta: {
    name: "diff",
    description: "Compare installed kit artifacts to the registry (respects L3 protected).",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    all: {
      type: "boolean",
      description: "Include matching files in the report",
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

    logger.info(`Registry: ${registry.root} (${registry.source})`);
    const entries = await diffAgainstRegistry(registry.root, args.cwd, manifest);
    const summary = summarizeDiff(entries);

    console.log(
      `Summary: match=${summary.match} drift=${summary.drift} missing-local=${summary["missing-local"]} missing-registry=${summary["missing-registry"]} protected=${summary.protected}`,
    );

    const rows = args.all ? entries : entries.filter((e) => e.status !== "match");
    if (rows.length === 0) {
      logger.success("No drift (matches only).");
      return;
    }
    for (const e of rows) {
      console.log(`${e.status.padEnd(18)} ${e.path}`);
    }
  },
});
