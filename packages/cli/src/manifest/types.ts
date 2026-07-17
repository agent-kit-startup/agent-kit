/**
 * Distribution manifest (.cursor/agent-kit.json).
 * Distinct from ProjectProfile in agent-kit.config.json (scan/wizard).
 * @see docs/agent-kit-manifest.md
 */
export interface AgentKitManifestRegistry {
  url?: string;
  ref?: string;
}

export interface AgentKitManifestOverride {
  path: string;
  replaces?: string;
  note?: string;
}

export interface AgentKitManifest {
  schemaVersion: 1;
  version: string;
  profile?: string;
  packs?: string[];
  skills?: string[];
  protected?: string[];
  overrides?: AgentKitManifestOverride[];
  registry?: AgentKitManifestRegistry;
  installedAt?: string;
}

export const MANIFEST_FILENAME = "agent-kit.json";
export const MANIFEST_RELATIVE_PATH = `.cursor/${MANIFEST_FILENAME}`;
export const MANIFEST_SCHEMA_VERSION = 1 as const;

/** Default L3 / session globs every install should protect. */
export const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  ".cursor/HANDOFF.md",
  ".cursor/plans/**",
  ".cursor/memory/**",
  ".cursor/context/**",
];

/** Initial L1 pack ids (membership refined in f1-domain-packs). */
export const DOMAIN_PACK_IDS: readonly string[] = [
  "cybersec",
  "devops",
  "engenharia-arquitetura",
  "clean-code",
  "gestao-projeto",
  "gestao-contexto",
  "quality",
];
