import type { AgentKitManifest } from "../manifest/types.js";
import { type ResolvedRegistry, resolveRegistryRoot } from "../registry/resolve.js";

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
