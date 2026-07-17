# Registry format — Agent Kit

Canonical catalog for installable units. SoT file: `registry/registry.json`.  
Generate/refresh with:

```bash
node scripts/build-registry.mjs
```

(Legacy `scripts/build-registry.sh` only scanned `.cursor/skills/` into an older flat format — prefer the Node builder for this monorepo.)

## schemaVersion 2

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | number | `2` — packs + artifact catalog |
| `skills.core` | object[] | Structural / high-reuse skills under `registry/skills/core/` |
| `skills.community` | object[] | Stack/community skills under `registry/skills/community/` |
| `packs` | object[] | L1 domain pack summaries (`registry/packs/<id>/`) |
| `artifacts` | object[] | Flat index of pack members (rules, skills, agents, commands, hooks) |

### Skill entry

| Field | Description |
|-------|-------------|
| `id` | Install id (`agent-kit add <id>`) |
| `title` | Display title (from SKILL frontmatter `name` when present) |
| `description` | Short description |
| `path` | Repo-relative directory containing `SKILL.md` |
| `version` | Semver from frontmatter (`version:`) — marketplace catalog |
| `category` | Catalog category from frontmatter (`category:`) |

### Pack entry

| Field | Description |
|-------|-------------|
| `id` | Pack id (`agent-kit add <id>` installs the whole pack) |
| `title` / `description` / `version` | From `pack.json` |
| `path` | Repo-relative pack directory (`pack.json` inside) |

Membership detail: `registry/packs/<id>/pack.json` — see [docs/domain-packs.md](docs/domain-packs.md) and [schemas/agent-kit.pack.schema.json](schemas/agent-kit.pack.schema.json).

### Artifact entry

| Field | Description |
|-------|-------------|
| `kind` | `rule` \| `skill` \| `agent` \| `command` \| `hook` |
| `id` | Stable id within kind |
| `path` | Repo-relative SoT path (or skill directory) |
| `pack` | Owning L1 pack id (when from a pack) |
| `layer` | `L0`–`L3` hint when known |

Today the builder indexes **pack members** into `artifacts`. Standalone L2 skills remain under `skills.*` only until they are referenced by a pack or an explicit L2 catalog pass.

## CLI

| Command | Behavior |
|---------|----------|
| `agent-kit add <skill-id>` | Copy skill into `.cursor/skills/{core\|community}/` |
| `agent-kit add <pack-id>` | Install every pack member (rule/skill/agent/command/hook) into `.cursor/` |

Skill ids and pack ids must not collide without flags. If both exist (e.g. `clean-code`), use:

```bash
agent-kit add --skill clean-code
agent-kit add --pack clean-code
```

## Example (truncated)

```json
{
  "schemaVersion": 2,
  "skills": {
    "core": [{ "id": "clean-code", "title": "Clean Code", "description": "...", "path": "registry/skills/core/clean-code" }],
    "community": [{ "id": "n8n-workflows", "title": "n8n Workflows", "description": "...", "path": "registry/skills/community/n8n-workflows" }]
  },
  "packs": [
    { "id": "cybersec", "title": "Cybersecurity", "description": "...", "version": "0.1.0", "path": "registry/packs/cybersec" }
  ],
  "artifacts": [
    { "kind": "skill", "id": "security-review", "path": "registry/skills/core/security-review", "pack": "cybersec", "layer": "L1" },
    { "kind": "agent", "id": "security-reviewer", "path": ".cursor/agents/security-reviewer.md", "pack": "cybersec", "layer": "L1" }
  ]
}
```

## Relation to project manifest

`.cursor/agent-kit.json` records which `packs` and `skills` a project opted into. The registry is the **catalog**; the manifest is the **installed set**. See [docs/agent-kit-manifest.md](docs/agent-kit-manifest.md).
