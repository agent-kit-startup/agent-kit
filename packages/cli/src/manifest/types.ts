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

/**
 * Default L3 / session globs every install should protect.
 * Do not blanket `.cursor/context/**`: kit-owned templates and
 * `config.example.json` must remain installable (L0). Session state only.
 */
export const DEFAULT_PROTECTED_PATHS: readonly string[] = [
  ".cursor/HANDOFF.md",
  ".cursor/plans/**",
  ".cursor/memory/**",
  ".cursor/context/config.json",
  ".cursor/context/current/**",
  ".cursor/context/backups/**",
];

/** Legacy blanket replaced by session globs in normalizeProtectedGlobs. */
export const LEGACY_CONTEXT_PROTECTED_GLOB = ".cursor/context/**";

/** Initial L1 pack ids (membership refined in f1-domain-packs). */
export const DOMAIN_PACK_IDS: readonly string[] = [
  "cybersec",
  "devops",
  "engineering-architecture",
  "clean-code",
  "project-management",
  "context-management",
  "quality",
];
