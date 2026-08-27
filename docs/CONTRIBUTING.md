# Contributing

Thanks for helping. Three kinds of contributions land well here: a skill, a docs fix, a CLI patch.

## Where your PR goes

The public repo is `agent-kit`. Open PRs against **`main`**. There is no long-lived `staging` branch on the public repo; that branch topology belongs to the private factory, and you do not need it.

## Setup

```bash
pnpm install
pnpm lint
pnpm test
```

Green before you push. Conventional Commits (`feat:`, `fix:`, `docs:`). Small PRs merge faster than big ones.

## Contributing a skill

Skills live at `registry/skills/community/<id>/SKILL.md`. If you work from a project that has the kit installed, `agent-kit contribute` is the return channel: it runs a hygiene gate over your skill and can write it into a local kit checkout with `--write`. It never pushes and never promotes anything. You still open the PR yourself.

## What the gate rejects

- Plans and `HANDOFF.md` in a commit. These are working state, not source.
- Factory-only CHANGELOG bullets in public-facing sections. Fence them.
- Claims the code does not back. Docs orient; code proves.

## House rules

- The public README is the consumer storefront. Factory workflow detail belongs in CONTRIBUTING and DEVELOPMENT, not the hero.
- Production promotion is human-confirmed, always. No PR changes that.
- When in doubt, open a small PR and ask in it. A rough patch with a clear question beats a polished guess.

Participation is covered by the [Code of Conduct](../.github/CODE_OF_CONDUCT.md). Not sure where a question belongs? [SUPPORT.md](../.github/SUPPORT.md). **Never** report a vulnerability in a public issue or PR - use the private channel in [SECURITY.md](../.github/SECURITY.md).

## Standards

- Conventional Commits
- Small, focused PRs
- Update docs when behavior changes
- **Changelog:** public surfaces (public GitHub file, GitHub Releases, landing product notes) take consumer and contributor product notes only. Fence factory-only bullets. See [DEVELOPMENT.md](DEVELOPMENT.md#public-changelog).
- **Base branch by repo:** target `main` for the **public repository** (`agent-kit`); target `staging` for the **private factory repository** (`agent-kit-dev`). The public repository has no long-lived `staging` branch. See [DEVELOPMENT.md](DEVELOPMENT.md) for the factory Git flow.
- **Cross-repo issue close form:** when a factory (`agent-kit-dev`) PR closes a public issue, use `Closes agent-kit-startup/agent-kit#N` (or the full issue URL). Bare `Closes #N` resolves against the PR's repository and will not close the public issue.
- **Cursor-native tooling:** prefer Cursor-supported MCP servers, workspace hooks, and the official SDK. Do not add or document parallel agent gateways - see [cursor-3-features.md](cursor-3-features.md#mcp-hooks-e-sdk).

## What belongs in Git (vs local-only)

See [repository-boundaries.md](repository-boundaries.md): daily Git targets the **private** repo (`agent-kit-dev`); the **public** repo is updated only via the allowlist sync after release. Registry contributions now flow to the **public** repo since Phase B - the public registry is canonical. Cursor plans and `HANDOFF.md` must not be committed; CI blocks the workflow if they are tracked.

## Registry contributions (marketplace catalog)

### Skills

Add community skills under `registry/skills/community/<skill-id>/SKILL.md`. Core skills need maintainer review (`registry/skills/core/`).

### Skins

Add community Agent Personas under `registry/personas/community/<persona-id>/persona.json`. See [creating-personas.md](creating-personas.md) for format and acceptance rules.

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
pnpm --filter @dadado/agent-kit-cli test # if CLI touched
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
pnpm --filter @dadado/agent-kit-cli start -- contribute \
  --cwd /path/to/consumer \
  --registry /path/to/agent-kit
```

See [contribute-upstream.md](contribute-upstream.md). Registry contributions now target the **public** repo as Phase B is complete - [topology-private-public.md](topology-private-public.md).

## Contributor funnel (issues to PR to upstream)

1. **Question or bug:** GitHub issue forms (Discussions is not enabled; see [SUPPORT.md](../.github/SUPPORT.md)).
2. **Code or skill PR:** this guide; public repo targets `main`, factory targets `staging`.
3. **Consumer-project drift:** [`agent-kit contribute`](contribute-upstream.md) (CLI never pushes).
4. **Vulnerability:** [SECURITY.md](../.github/SECURITY.md) private channel only.

Maintainer replies that are promotional still need HITL (skill `mission-kit-comms`). Cursor Marketplace publisher submit is not this funnel.

## Telling people about Mission Kit

Drafts and cadence live in [comms.md](comms.md). The launch paste in [public-launch-announcement.md](public-launch-announcement.md) remains valid seed copy. Nothing in the kit posts to social networks by itself.

## Contribution license (follow-on)

Inbound CLA/DCO terms for a paid-commercial PolyForm NC project are a tracked follow-on (polyform residual E). Until that ships, pull requests are welcome under the repository LICENSE for noncommercial contribution review, and maintainers may request a CLA before merging commercial-impact changes.
