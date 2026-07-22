# Upstream contribute - `agent-kit contribute`

Return channel from a **consumer project** back to the Agent Kit registry. Complements [migrate-consumer.md](migrate-consumer.md), [layers-spec.md](layers-spec.md), and [CONTRIBUTING.md](CONTRIBUTING.md).

## When to use

- You edited an installed L0 / pack / skill file and the change should be shared (not kept as a silent fork).
- You authored a new skill under `.cursor/skills/...` that belongs in `registry/skills/`.
- You created a workspace skin that belongs in `registry/skins/community/`.
- Golden rule from layers-spec: do **not** hand-edit kit files as a permanent project fix - override via L3 **or** contribute upstream.

## Flow

```text
consumer project
  → agent-kit contribute [--path …]
  → anti-slop / hygiene gate
  → (optional) --write into local kit checkout
  → human opens PR → main (public registry is canonical after Phase B)
```

HITL: the CLI never pushes and never runs `/git-prod`. `--write` only copies files into a local checkout.

## Commands

```bash
# Report drift vs registry + gate results (dry run)
pnpm --filter @dadado/agent-kit-cli start -- contribute \
  --cwd /path/to/project \
  --registry /path/to/agent-kit

# Propose a specific new/edited path
pnpm --filter @dadado/agent-kit-cli start -- contribute \
  --cwd /path/to/project \
  --registry /path/to/agent-kit \
  --path .cursor/skills/community/my-skill/SKILL.md \
  --no-drift

# Copy accepted files into the kit checkout (still no push)
pnpm --filter @dadado/agent-kit-cli start -- contribute \
  --cwd /path/to/project \
  --registry /path/to/agent-kit \
  --write
```

Then in the kit repo: branch → commit → `gh pr create --base main` (review the suggested PR body from the CLI).

## Gate (entry)

Rejected when any of these apply:

| Check | Examples |
|-------|----------|
| Session / L3 paths | `HANDOFF.md`, `plans/**`, `memory/**`, `context/**` |
| Secrets | AWS keys, `ghp_*`, private key blocks, inline `token=` / `password=` |
| Hygiene / anti-slop | Agent metalinguage, “conforme falamos”, chat-transient wording |
| Size | File larger than 200 KiB |

## Mapping

| Project path | Registry path |
|--------------|---------------|
| L0 / pack member targets | Same relative path (or pack `source`) |
| `.cursor/skills/<cat>/<id>/SKILL.md` | `registry/skills/<cat>/<id>/SKILL.md` (guessed when not in manifest) |
| `.cursor/skins/<id>/skin.json` | `registry/skins/community/<id>/skin.json` (community skins only) |

New skills still need a `registry/registry.json` entry (and pack membership if applicable) - update those in the PR. Skins are discovered by directory structure and do not require registry entries.

## Target repo (after Phase B)

Registry contributions target the **public** `agent-kit` repository (main branch) - the public registry is now canonical ([topology-private-public.md](topology-private-public.md)). CLI and sync tooling changes still target the private repository.

## Acceptance (`f5-upstream-flow`)

- [x] `agent-kit contribute` command in CLI
- [x] Gate covered by unit tests
- [x] Docs: this file + CONTRIBUTING + getting-started
- [x] Dry-run against a migrated consumer (no false positives when in sync)
