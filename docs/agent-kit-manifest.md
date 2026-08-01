# The manifest (`.cursor/agent-kit.json`)

Every project that installs Agent Kit gets a small file at `.cursor/agent-kit.json`. It's the kit's memory of what it did to your project: which version it installed, which packs and skills you added, and which of your files it must never touch. Without it, an update would be guesswork - the kit wouldn't know what it put there or what's safe to overwrite.

The commands read it directly: `update` uses it to refresh the right files, `diff` uses it to compare against the latest, `status` prints it back to you.

**Machine-readable schema:** [schemas/agent-kit.manifest.schema.json](../schemas/agent-kit.manifest.schema.json). Layer model behind the fields: [layers-spec.md](layers-spec.md).

## Three files under `.cursor/`

| File | Role | Written by | Commit? |
|------|------|------------|---------|
| **`agent-kit.json`** | The manifest (this doc): what's installed | `install` / `add` / `update`; bootstrap / `@install.md` | **Yes** (version with the project) |
| **`agent-kit.config.json`** | Guided-setup **profile** (stack, IDE, git workflow) | `agent-kit init` | **No** (typically gitignored; local profile) |
| **`agent-kit.managed-hashes.json`** | Managed-content hash ledger for the consumer overlay (last kit-owned content under agents / skills / commands) | `install` / `add` / `update` when overlay paths are applied | **Yes** (recommended): commit so the ledger survives clone and teammates do not re-trigger first-update preserve/seed ambiguity |

The profile and the manifest stay separate on purpose: the profile drives guided setup; the manifest drives updates against the kit's source. The ledger is kit-written state for overlay preservation, not a substitute for either.

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `schemaVersion` | yes | Manifest format version. Current: `1`. |
| `version` | yes | Installed kit version (semver). |
| `profile` | no | Guided-setup profile id (`default`, `lean`, …). |
| `packs` | no | Installed pack ids (see [domain packs](domain-packs.md)). Empty if none. |
| `skills` | no | Installed on-demand skill ids. |
| `protected` | no | File patterns (project-relative) that `update` must skip. |
| `overrides` | no | Your local replacements for kit files (`path`, optional `replaces`, `note`). |
| `registry` | no | `{ url, ref }` used for the last install/update. |
| `installedAt` | no | ISO-8601 time of the last successful write. |

JSON Schema enforces types, semver pattern on `version`, and kebab-case ids for packs/skills.

## Default protected paths

Every install should protect session and project-unique state (also gitignored where applicable):

```text
.cursor/HANDOFF.md
.cursor/plans/**
.cursor/memory/**
.cursor/context/config.json
.cursor/context/current/**
.cursor/context/backups/**
```

Do **not** protect the whole `.cursor/context/**` tree: kit L0 ships `templates/**` and `config.example.json` there. Older manifests that listed `.cursor/context/**` are normalized on `install`/`update` to the session globs above.

Do **not** blanket-protect `.cursor/agents/**`, `.cursor/skills/**`, or `.cursor/commands/**`: that blocks pack and `agent-kit add` installs. User-added basenames in those trees already survive update; kit-owned files with local drift are preserved via the consumer overlay (managed-content hashes in `.cursor/agent-kit.managed-hashes.json`). Prefer distinct basenames or `overrides` for intentional forks; use `diff` / contribute when you want upstream to absorb a local edit. See [layers-spec.md](layers-spec.md) and decision `2026-07-29_consumer-l0-overlay-agents-optional.md`.

Add your project's own domain rules as extra `protected` patterns or `overrides` entries when they live outside the overlay trees.

## Example

```json
{
  "$schema": "../schemas/agent-kit.manifest.schema.json",
  "schemaVersion": 1,
  "version": "3.0.0",
  "profile": "default",
  "packs": ["clean-code", "context-management"],
  "skills": ["json-data-config", "sql-postgres"],
  "protected": [
    ".cursor/HANDOFF.md",
    ".cursor/plans/**",
    ".cursor/memory/**",
    ".cursor/context/config.json",
    ".cursor/context/current/**",
    ".cursor/context/backups/**",
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

When files overlap, more specific wins: **L3 > L2 > L1 > L0.** `protected` and `overrides` are how your own files take priority without silently editing an installed kit file. See [layers-spec.md](layers-spec.md).
