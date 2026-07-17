# Agent Kit manifest (`agent-kit.json`)

Canonical project manifest for Agent Kit distribution. Complements [layers-spec.md](layers-spec.md) (L0–L3 model) and [registry-schema.md](../registry-schema.md) (skills catalog format).

**Path:** `.cursor/agent-kit.json`  
**Machine schema:** [schemas/agent-kit.manifest.schema.json](../schemas/agent-kit.manifest.schema.json)

## Purpose

Record what the project has installed so `agent-kit update` / `diff` / `status` can:

1. Know the **kit version** in use.
2. Re-apply **L1 packs** and **L2 skills** without guessing.
3. **Never overwrite** L3 / session paths listed as protected.

Without a manifest, every workspace is a one-shot folder copy (see [drift-inventory.md](drift-inventory.md)).

## Two files under `.cursor/`

| File | Role | Written by |
|------|------|------------|
| **`agent-kit.json`** | Distribution manifest (this doc) | `install` / `add` / `update` (Phase 2); bootstrap / `@install.md` |
| **`agent-kit.config.json`** | CLI scan + wizard **profile** (stack, IDE, git workflow) | `agent-kit init` today |

Do not merge them casually: the profile drives generators; the manifest drives lifecycle against the registry. Phase 2 may teach `status` to show both.

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `schemaVersion` | yes | Manifest format integer. Current: `1`. |
| `version` | yes | Installed product version (semver), aligned with kit releases. |
| `profile` | no | Bootstrap profile id (`default`, `lean`, …). |
| `packs` | no | L1 pack ids (see layers-spec). Empty until packs are chosen. |
| `skills` | no | L2 registry skill ids installed on demand. |
| `protected` | no | Globs (project-relative) that `update` must skip. |
| `overrides` | no | Explicit L3 overrides (`path`, optional `replaces`, `note`). |
| `registry` | no | `{ url, ref }` used for the last install/update. |
| `installedAt` | no | ISO-8601 time of last successful write. |

JSON Schema enforces types, semver pattern on `version`, and kebab-case ids for packs/skills.

## Default protected paths

Every install should protect session and project-unique state (also gitignored where applicable):

```text
.cursor/HANDOFF.md
.cursor/plans/**
.cursor/memory/**
.cursor/context/**
```

Add project-unique rules/skills/commands as extra globs or `overrides` entries. Never list kit L0 paths as protected to “keep a local edit” — that is an illegal in-place edit; use an L3 override or contribute upstream.

## Example

```json
{
  "$schema": "../schemas/agent-kit.manifest.schema.json",
  "schemaVersion": 1,
  "version": "3.0.0",
  "profile": "default",
  "packs": ["clean-code", "gestao-contexto"],
  "skills": ["json-data-config", "sql-postgres"],
  "protected": [
    ".cursor/HANDOFF.md",
    ".cursor/plans/**",
    ".cursor/memory/**",
    ".cursor/context/**",
    ".cursor/rules/my-domain-context.mdc"
  ],
  "overrides": [],
  "registry": {
    "url": "https://github.com/agent-kit-startup/agent-kit",
    "ref": "v3.0.0"
  },
  "installedAt": "2026-07-16T15:00:00.000Z"
}
```

(`$schema` is optional for editors; included in the JSON Schema as an allowed property.)

## Precedence reminder

**L3 > L2 > L1 > L0.** Protected + overrides are how L3 wins without silent mutation of installed kit files.

## Acceptance (Phase 1 — `f1-manifest`)

- [x] JSON Schema published under `schemas/`
- [x] This doc describes fields and relation to `agent-kit.config.json`
- [x] Dogfood: this repo ships `.cursor/agent-kit.json`
- [x] CLI `install`/`update`/`diff` consume the schema (Phase 2 — `f2-cli-lifecycle`)
