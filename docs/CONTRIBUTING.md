# Contributing

Agent Kit is a developer bootstrapper for AI-assisted IDEs. Contributions welcome — from skills to CLI features to docs.

## Setup

```bash
pnpm install
pnpm lint
pnpm test
```

## Standards

- Conventional Commits
- Small, focused PRs
- Update docs when behavior changes
- Open PRs from a fork or short-lived branch directly to `main`; the public repository has no long-lived `staging` branch
- **Cursor-native tooling:** prefer Cursor-supported MCP servers, workspace hooks, and the official SDK. Do not add or document parallel agent gateways — see [cursor-3-features.md](cursor-3-features.md#mcp-hooks-e-sdk).

## What belongs in Git (vs local-only)

See [repository-boundaries.md](repository-boundaries.md): daily Git targets the **private** repo (`agent-kit-dev`); the **public** repo is updated only via the allowlist sync after release. Cursor plans and `HANDOFF.md` must not be committed; CI blocks the workflow if they are tracked.

## Registry contributions (marketplace catalog)

Add community skills under `registry/skills/community/<skill-id>/SKILL.md`. Core skills need maintainer review (`registry/skills/core/`).

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

See [contribute-upstream.md](contribute-upstream.md). Prefer PRs to the **public** repo as Phase B lands — [topology-private-public.md](topology-private-public.md).
