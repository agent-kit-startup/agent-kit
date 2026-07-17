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
- **Cursor-native tooling:** do not add or document **OpenClaw** (or similar parallel agent gateways). Prefer MCP suportado pelo Cursor, hooks do workspace e o SDK oficial — alinhado a [cursor-3-features.md](cursor-3-features.md#mcp-hooks-e-sdk-sem-openclaw).

## GitHub CLI (`gh`)

Fine-grained personal access tokens cannot be granted the **`checks:read`** scope on GitHub’s side. Commands such as `gh run watch` may still succeed but print **403** when fetching run **annotations** (the workflow result itself is unaffected).

To avoid that warning, authenticate `gh` with one of:

1. **Browser (OAuth) — recommended:** `gh auth login` → GitHub.com → HTTPS → *Login with a web browser*.
2. **Classic PAT** with the **`repo`** scope, passed to `gh auth login --with-token`.

You can keep a fine-grained PAT for other tools; use the options above for the credential `gh` stores in the OS keyring on this machine.

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
- [ ] No secrets or agent metalinguage (same as `agent-kit contribute` gate)
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
