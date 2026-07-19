# Migrate a consumer project off nested `agent-kit/`

Generic runbook for any project to migrate from nested `agent-kit/` folder to the registry-based installation. Complements [bootstrap.md](bootstrap.md) and [drift-inventory.md](drift-inventory.md).

## Prerequisites

- Local checkout of the Agent Kit monorepo (registry + CLI), or a published `@agent-kit/cli` that can reach the registry.
- Inventory of L3 uniques for the project (domain rules, one-off commands/skills, plans/memory).

## Steps

1. **Snapshot L3** - copy hashes or backups of domain rules and `HANDOFF.md` before install.
2. **Install from registry** (project root):

```bash
pnpm --filter @agent-kit/cli start -- install \
  --cwd /path/to/project \
  --registry /path/to/agent-kit \
  --pack context-management,clean-code
```

3. **Protect L3** - extend `.cursor/agent-kit.json` `protected` (and optional `overrides`) with domain paths, e.g.:

```text
.cursor/rules/YOUR_PROJECT-context.mdc
.cursor/rules/lessons-learned.mdc
.cursor/commands/YOUR_PROJECT-only.md
```

4. **Add registry skills** the project already used:

```bash
pnpm --filter @agent-kit/cli start -- add <skill-id> --skill \
  --cwd /path/to/YOUR_PROJECT --registry /path/to/agent-kit
```

Skills that exist only under the SoT `.cursor/skills/` tree (not under `registry/skills/`) stay as local copies until promoted to the registry (`f6-coherence`).

5. **Prove update is safe:**

```bash
pnpm --filter @agent-kit/cli start -- update --cwd /path/to/YOUR_PROJECT --registry /path/to/agent-kit
pnpm --filter @agent-kit/cli start -- diff --cwd /path/to/YOUR_PROJECT --registry /path/to/agent-kit
pnpm --filter @agent-kit/cli start -- status --cwd /path/to/YOUR_PROJECT --registry /path/to/agent-kit
```

Expect: L3 files unchanged; `diff` shows protected skips, not destructive drift on domain paths.

6. **Delete** the nested `agent-kit/` directory (including templates/`node_modules` if present).

7. **Validate orchestration surface** - confirm L0 commands exist:

- `.cursor/commands/run-plan-loop.md`
- `.cursor/commands/run-plan-orchestrated.md`
- `autogit/plan-routine.md`

Against a **real** plan in `.cursor/plans/`: next implementable to-do can be run with `/run-plan-orchestrated` (or loop). Do not run `/git-prod` from orchestrated modes.

## Acceptance checks

After migration, verify:

| Check | Expected result |
|-------|----------------|
| Manifest `.cursor/agent-kit.json` | Present with version, packs, and protected L3 paths |
| Nested `agent-kit/` | Removed |
| L3 preserved after `update` | Domain rules, session files (`HANDOFF.md`), and unique commands/skills unchanged |
| Registry skills added | Skills previously copied from the kit now installed via registry |
| Local-only skills kept | Project-unique skills not in registry preserved |
| Orchestration commands | `.cursor/commands/run-plan-orchestrated.md` and `run-plan-loop.md` available |
| `diff` clean | No unexpected changes; `protected` paths properly skipped |