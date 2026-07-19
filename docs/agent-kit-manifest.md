# The manifest (`.cursor/agent-kit.json`)

Every project that installs Agent Kit gets a small file at `.cursor/agent-kit.json`. It's the kit's memory of what it did to your project: which version it installed, which packs and skills you added, and which of your files it must never touch. Without it, an update would be guesswork — the kit wouldn't know what it put there or what's safe to overwrite.

The commands read it directly: `update` uses it to refresh the right files, `diff` uses it to compare against the latest, `status` prints it back to you.

**Machine-readable schema:** [schemas/agent-kit.manifest.schema.json](../schemas/agent-kit.manifest.schema.json). Layer model behind the fields: [layers-spec.md](layers-spec.md).

## Two files under `.cursor/`

| File | Role | Written by |
|------|------|------------|
| **`agent-kit.json`** | The manifest (this doc): what's installed | `install` / `add` / `update`; bootstrap / `@install.md` |
| **`agent-kit.config.json`** | Guided-setup **profile** (stack, IDE, git workflow) | `agent-kit init` |

They're separate on purpose: the profile drives the guided setup; the manifest drives updates against the kit's source.

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
.cursor/context/**
```

Add your project's own rules/skills/commands as extra patterns or `overrides` entries. Don't list a kit file as protected just to keep a local edit — that quietly forks it. Use an override or contribute the change upstream instead.

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

When files overlap, more specific wins: **L3 > L2 > L1 > L0.** `protected` and `overrides` are how your own files take priority without silently editing an installed kit file. See [layers-spec.md](layers-spec.md).
