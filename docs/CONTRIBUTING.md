# Contributing

Agent Kit is a developer bootstrapper for AI-assisted IDEs. Contributions welcome - from skills to CLI features to docs.

## Setup

```bash
pnpm install
pnpm lint
pnpm test
```

## Contributor quickstart

New to the kit? Here's where things land and how to test before your PR:

- **Skills:** Community contributions go under `registry/skills/community/<skill-id>/SKILL.md` - see the [new skill vs improving existing](#new-skill-vs-improving-an-existing-one) section below
- **Core changes:** CLI features, base rules, and templates live in their respective folders (`packages/cli/`, `.cursor/`, etc.)
- **Test locally:** `pnpm install && pnpm lint && pnpm test` from the repo root
- **Test on a project:** `pnpm --filter @agent-kit/cli start install --cwd /path/to/test-project`

See [getting-started.md](getting-started.md) for the full development setup and workflow details.

## Standards

- Conventional Commits
- Small, focused PRs
- Update docs when behavior changes
- Open PRs from a fork or short-lived branch directly to `main`; the public repository has no long-lived `staging` branch
- **Cursor-native tooling:** prefer Cursor-supported MCP servers, workspace hooks, and the official SDK. Do not add or document parallel agent gateways - see [cursor-3-features.md](cursor-3-features.md#mcp-hooks-e-sdk).

## What belongs in Git (vs local-only)

See [repository-boundaries.md](repository-boundaries.md): daily Git targets the **private** repo (`agent-kit-dev`); the **public** repo is updated only via the allowlist sync after release. Cursor plans and `HANDOFF.md` must not be committed; CI blocks the workflow if they are tracked.

## Registry contributions (marketplace catalog)

Add community skills under `registry/skills/community/<skill-id>/SKILL.md`. Core skills need maintainer review (`registry/skills/core/`).

### New skill vs improving an existing one

Both paths are valid contributions:

- **Improve an existing skill** when your content would change or overlap the `description` of a skill already in the registry (the description is the discovery trigger). Open a PR against that skill's folder and bump `version` (semver).
- **Create a new skill** only for a scope no existing skill covers. Propose an id in `domain-tool` kebab-case (e.g. `sql-postgres`, `n8n-workflows`). Ids are permanent once published: they become install paths and manifest entries in consumer projects, so a rename is a breaking change.

Naming and scope are settled during review; maintainers may ask for an id change before merge. Dedupe is a review-gate responsibility, not the contributor's risk: when in doubt, send the PR and flag the closest existing skills.

Pack membership is curated separately. Contributions land as community skills first; promotion into a Domain pack (or core) is a maintainer decision.

Required frontmatter:

```yaml
---
name: my-skill
description: One-line when-to-use (triggers discovery).
version: 0.1.0
category: integrations
---
```

Then:

```bash
node scripts/build-registry.mjs   # refresh registry/registry.json
pnpm --filter @agent-kit/cli test # if CLI touched
```

### Quality gate (PR checklist)

- [ ] No HANDOFF / plans / memory / `.env` / credentials
- [ ] No secrets or agent metalanguage (same as `agent-kit contribute` gate)
- [ ] Dedupe: listed the closest existing skills and why this is not an overlap (or targeted the existing skill instead)
- [ ] `version` + `category` present; semver bumped if behavior changed
- [ ] Stack stays `community/`; do not add product PM/n8n as Core Pack `alwaysApply` rules
- [ ] `registry.json` updated via the builder
- [ ] Docs: link from [marketplace.md](marketplace.md) if adding a new category

### From a consumer project

```bash
pnpm --filter @agent-kit/cli start -- contribute \
  --cwd /path/to/consumer \
  --registry /path/to/agent-kit
```

See [contribute-upstream.md](contribute-upstream.md). Prefer PRs to the **public** repo as Phase B lands - [topology-private-public.md](topology-private-public.md).
