import type { AgentKitManifest, AgentKitManifestOverride } from "./types.js";
import { MANIFEST_SCHEMA_VERSION } from "./types.js";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const KEBAB_ID = /^[a-z][a-z0-9-]*$/;

export class ManifestValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStringArray(label: string, value: unknown, issues: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return undefined;
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "string" || item.length === 0) {
      issues.push(`${label}[${i}] must be a non-empty string`);
      continue;
    }
    out.push(item);
  }
  return out;
}

function assertKebabIdArray(label: string, value: unknown, issues: string[]): string[] | undefined {
  const arr = assertStringArray(label, value, issues);
  if (!arr) return arr;
  for (let i = 0; i < arr.length; i++) {
    if (!KEBAB_ID.test(arr[i] ?? "")) {
      issues.push(`${label}[${i}] must match ${KEBAB_ID}`);
    }
  }
  return arr;
}

function parseOverrides(value: unknown, issues: string[]): AgentKitManifestOverride[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push("overrides must be an array");
    return undefined;
  }
  const out: AgentKitManifestOverride[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isPlainObject(item)) {
      issues.push(`overrides[${i}] must be an object`);
      continue;
    }
    if (typeof item.path !== "string" || item.path.length === 0) {
      issues.push(`overrides[${i}].path must be a non-empty string`);
      continue;
    }
    const entry: AgentKitManifestOverride = { path: item.path };
    if (item.replaces !== undefined) {
      if (typeof item.replaces !== "string" || item.replaces.length === 0) {
        issues.push(`overrides[${i}].replaces must be a non-empty string`);
      } else {
        entry.replaces = item.replaces;
      }
    }
    if (item.note !== undefined) {
      if (typeof item.note !== "string") {
        issues.push(`overrides[${i}].note must be a string`);
      } else {
        entry.note = item.note;
      }
    }
    out.push(entry);
  }
  return out;
}

/**
 * Validate and normalize an unknown JSON value into AgentKitManifest.
 * Throws ManifestValidationError when required fields or types fail.
 */
export function parseAgentKitManifest(raw: unknown): AgentKitManifest {
  const issues: string[] = [];
  if (!isPlainObject(raw)) {
    throw new ManifestValidationError("Manifest must be a JSON object", ["root must be object"]);
  }

  const { $schema: _schema, ...rest } = raw;
  void _schema;

  if (rest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof rest.version !== "string" || !SEMVER.test(rest.version)) {
    issues.push("version must be a semver string");
  }

  if (
    rest.profile !== undefined &&
    (typeof rest.profile !== "string" || rest.profile.length === 0)
  ) {
    issues.push("profile must be a non-empty string");
  }

  const packs = assertKebabIdArray("packs", rest.packs, issues);
  const skills = assertKebabIdArray("skills", rest.skills, issues);
  const protectedPaths = assertStringArray("protected", rest.protected, issues);
  const overrides = parseOverrides(rest.overrides, issues);

  let registry: AgentKitManifest["registry"];
  if (rest.registry !== undefined) {
    if (!isPlainObject(rest.registry)) {
      issues.push("registry must be an object");
    } else {
      registry = {};
      if (rest.registry.url !== undefined) {
        if (typeof rest.registry.url !== "string") {
          issues.push("registry.url must be a string");
        } else {
          registry.url = rest.registry.url;
        }
      }
      if (rest.registry.ref !== undefined) {
        if (typeof rest.registry.ref !== "string" || rest.registry.ref.length === 0) {
          issues.push("registry.ref must be a non-empty string");
        } else {
          registry.ref = rest.registry.ref;
        }
      }
    }
  }

  if (rest.installedAt !== undefined && typeof rest.installedAt !== "string") {
    issues.push("installedAt must be a string");
  }

  const allowed = new Set([
    "schemaVersion",
    "version",
    "profile",
    "packs",
    "skills",
    "protected",
    "overrides",
    "registry",
    "installedAt",
  ]);
  for (const key of Object.keys(rest)) {
    if (!allowed.has(key)) {
      issues.push(`unknown field: ${key}`);
    }
  }

  if (issues.length > 0) {
    throw new ManifestValidationError(`Invalid agent-kit.json (${issues.length} issue(s))`, issues);
  }

  const manifest: AgentKitManifest = {
    schemaVersion: 1,
    version: rest.version as string,
  };
  if (typeof rest.profile === "string") manifest.profile = rest.profile;
  if (packs) manifest.packs = packs;
  if (skills) manifest.skills = skills;
  if (protectedPaths) manifest.protected = protectedPaths;
  if (overrides) manifest.overrides = overrides;
  if (registry) manifest.registry = registry;
  if (typeof rest.installedAt === "string") manifest.installedAt = rest.installedAt;
  return manifest;
}
