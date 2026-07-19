# Creating Skills

Skills extend what Agent Kit knows about your workflow. They're installed via `agent-kit add <skill>` and live alongside your IDE setup.

## File format

Each skill should provide a `SKILL.md` with:
- objective
- decision rules
- expected outputs

## Where to place

- Core: `registry/skills/core/`
- Community: `registry/skills/community/`

## Registering

Add the skill metadata to `registry/registry.json` (or run `node scripts/build-registry.mjs`) so `agent-kit add <skill>` can install it. Packs are listed under `packs` / `registry/packs/` - see [registry-schema.md](../registry-schema.md) and [domain-packs.md](domain-packs.md).
