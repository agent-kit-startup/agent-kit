import type { AgentKitManifest } from "../manifest/types.js";
import {
  DEFAULT_REGISTRY_REF,
  DEFAULT_REGISTRY_URL,
  type ResolvedRegistry,
  resolveRegistryRoot,
} from "../registry/resolve.js";
import { logger } from "../utils/logger.js";

/** Shared registry resolution for install/add/update/diff. */
export async function resolveRegistryFromCli(options: {
  cwd: string;
  registry?: string;
  url?: string;
  ref?: string;
  refresh?: boolean;
  manifest?: AgentKitManifest | null;
}): Promise<ResolvedRegistry> {
  const fromManifest = options.manifest?.registry;
  // A committed manifest can point the registry at any https URL; say so before
  // any fetch so the source is never silent. --url / --registry take precedence.
  if (!options.registry && !options.url && fromManifest?.url) {
    const ref = options.ref ?? fromManifest.ref ?? DEFAULT_REGISTRY_REF;
    logger.info(`registry: ${fromManifest.url}@${ref} (from manifest)`);
    if (fromManifest.url !== DEFAULT_REGISTRY_URL) {
      logger.warn(
        `registry url from .cursor/agent-kit.json is not the default ${DEFAULT_REGISTRY_URL}; verify you trust ${fromManifest.url}`,
      );
    }
  }
  return resolveRegistryRoot({
    cwd: options.cwd,
    registryPath: options.registry,
    registryUrl: options.url ?? fromManifest?.url,
    registryRef: options.ref ?? fromManifest?.ref,
    refresh: options.refresh,
  });
}

export const REGISTRY_CLI_ARGS = {
  registry: {
    type: "string" as const,
    description: "Local path to a kit checkout that contains registry/",
  },
  url: {
    type: "string" as const,
    description: "Remote registry git URL (default: public agent-kit)",
  },
  ref: {
    type: "string" as const,
    description: "Git ref for remote registry (branch or tag)",
  },
  refresh: {
    type: "boolean" as const,
    description: "Refresh cached remote registry",
    default: false,
  },
};
