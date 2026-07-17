export interface RegistrySkill {
  id: string;
  title: string;
  description: string;
  path: string;
  /** Semver from SKILL.md frontmatter when present (marketplace catalog). */
  version?: string;
  /** Catalog category (quality, dados, integrations, …). */
  category?: string;
}

export interface RegistryPackSummary {
  id: string;
  title: string;
  description: string;
  version: string;
  path: string;
}

export type RegistryArtifactKind = "rule" | "skill" | "agent" | "command" | "hook";

export interface RegistryArtifact {
  kind: RegistryArtifactKind;
  id: string;
  path: string;
  /** Optional pack that owns this artifact (L1). */
  pack?: string;
  /** Layer hint when known. */
  layer?: "L0" | "L1" | "L2" | "L3";
}

/**
 * Registry index (registry/registry.json).
 * schemaVersion 2 adds packs + flat artifact catalog beyond skills.
 */
export interface RegistryIndex {
  schemaVersion?: number;
  skills: {
    core: RegistrySkill[];
    community: RegistrySkill[];
  };
  packs?: RegistryPackSummary[];
  artifacts?: RegistryArtifact[];
}
