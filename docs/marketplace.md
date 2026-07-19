# Marketplace catalog - registry as a living catalog

How Agent Kit skills and packs are discovered, versioned, and listed for `agent-kit add` and (optionally) the Cursor Marketplace. Depends on [topology-private-public.md](topology-private-public.md) Phase B for a stable public SoT.

## Surfaces

| Surface | Role |
|---------|------|
| `registry/registry.json` | Machine catalog (schemaVersion 2) - skills + packs + artifacts |
| `agent-kit add` / `install` | Install from local checkout or remote git URL/ref |
| `.cursor-plugin/plugin.json` | Cursor plugin manifest for Marketplace listing of the Core Pack shell |
| GitHub public repo | Human browsing + PRs (gate in CONTRIBUTING) |

The **CLI catalog** is the registry index. The **Cursor Marketplace** is a distribution channel for the plugin wrapper - it does not replace `agent-kit add` for stack skills.

## Versioning per artifact

### Skills

Frontmatter on `registry/skills/{core|community}/<id>/SKILL.md`:

```yaml
---
name: clean-code
description: …
version: 0.1.0
category: quality
---
```

`node scripts/build-registry.mjs` copies `version` and `category` into `registry.json`. Bump **semver** when behavior changes; patch for docs-only.

### Packs

`registry/packs/<id>/pack.json` already has `version`. Bump when membership or member contracts change.

### Pinning (fleet)

Consumers pin via manifest `registry.ref` (tag or branch):

```json
"registry": { "url": "https://github.com/agent-kit-startup/agent-kit", "ref": "v3.1.0" }
```

## Quality gate (PR entry)

Same rules as `agent-kit contribute` (see [contribute-upstream.md](contribute-upstream.md) and CONTRIBUTING):

1. No session/L3 paths (HANDOFF, plans, memory, context).
2. No secrets / private keys / PATs.
3. No agent metalinguage or chat-transient wording.
4. Skill has frontmatter: `name`, `description`, `version`, `category`.
5. `node scripts/build-registry.mjs` run; `registry.json` committed if changed.
6. Stack skills stay under `community/`; structural under `core/` only with maintainer review.

## Cursor Marketplace

1. Keep `.cursor-plugin/plugin.json` version aligned with product releases.
2. Plugin ships the **structural** experience (rules/commands samples); stack skills remain `agent-kit add`.
3. Submission / listing follows Cursor’s publisher flow for the public repo - do not document third-party gateways.
4. After Phase B cutover, Marketplace updates track **public** tags, not private history.

## Listing UX (CLI)

```bash
# Install by id from remote registry
npx @agent-kit/cli add n8n-workflows --url https://github.com/agent-kit-startup/agent-kit --ref main

# Inspect catalog locally
node -e "console.log(JSON.stringify(require('./registry/registry.json').skills,null,2))"
```

Future nicety (not required for this to-do): `agent-kit search <query>` over `registry.json`.

## Acceptance (`f7-marketplace`)

- [x] Skill frontmatter `version` + `category` in registry SoT
- [x] Builder emits version/category into `registry.json`
- [x] CONTRIBUTING quality gate documented
- [x] This marketplace doc + plugin.json thesis/version note
- [ ] Live Cursor Marketplace submission (publisher ops / HITL)
- [ ] Phase B cutover so public catalog is not overwritten by private sync
