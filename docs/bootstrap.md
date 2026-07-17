# Bootstrap — install without a nested `agent-kit/` folder

Canonical way to put Agent Kit into a **consumer project**. Complements [layers-spec.md](layers-spec.md), [agent-kit-manifest.md](agent-kit-manifest.md), and [getting-started.md](getting-started.md).

## Anti-pattern (retired)

Do **not** copy or clone the full Agent Kit monorepo into the project as `agent-kit/` (with or without `node_modules` / `packages/`). That model caused version drift, unknown kit versions, and no safe `update` path. See [drift-inventory.md](drift-inventory.md).

## Target layout after install

Only project-local artifacts — no nested kit repo:

```text
your-project/
├── .cursor/
│   ├── agent-kit.json          # manifest (version, packs, protected L3)
│   ├── rules/                  # L0 (+ L1 if packs chosen)
│   ├── commands/               # L0 slash commands
│   ├── hooks/pre-commit/       # at least check-secrets (L0)
│   ├── skills/                 # L2 only if added
│   ├── agents/                 # from packs / skills if added
│   ├── plans/                  # L3 (session) — create as needed
│   ├── memory/                 # L3
│   ├── context/                # L3
│   └── HANDOFF.md              # L3
└── autogit/
    ├── gitupdate.md            # L0 — staging → prod prompts
    └── plan-routine.md         # L0 — plan modes (manual / loop / orchestrated)
```

Optional later: `.git/hooks/prepare-commit-msg` from the kit’s `git-hooks/` template (copy the single file, not the kit tree).

## Preferred path — CLI

From the **project root**:

```bash
# Published CLI (when available on npm)
npx @agent-kit/cli install
npx @agent-kit/cli install --pack clean-code,gestao-contexto

# Or from a local checkout of the kit monorepo
pnpm --filter @agent-kit/cli start install --cwd /path/to/your-project
```

What `install` does:

1. Resolves the registry (local monorepo, `--registry`, or remote cache via `--url` / manifest `registry`).
2. Copies **L0** artifacts into `.cursor/` + `autogit/` (never the whole monorepo).
3. Optionally installs L1 packs (`--pack`) and refreshes L2 skills already listed in the manifest.
4. Writes `.cursor/agent-kit.json` with version and protected L3 globs.

Ongoing lifecycle (same registry, L3 never overwritten):

| Command | Role |
|---------|------|
| `agent-kit add <id>` | L1 pack or L2 skill |
| `agent-kit update` | Re-apply L0/packs/skills; skip `protected` |
| `agent-kit diff` | Drift vs registry |
| `agent-kit status` | Version, packs, health |

## Porta B — `@install.md` in chat

If the user does not want a CLI on the path: open the project in the IDE, attach root [`install.md`](../install.md), and ask to install. The agent must produce the **same** layout and manifest as the CLI (L0 + `agent-kit.json` + `autogit/`), not a nested `agent-kit/` tree.

## Migrating an existing nested copy

1. Inventory L3 uniques (domain rules, local skills, plans/memory) — see [drift-inventory.md](drift-inventory.md).
2. Run `agent-kit install` (or chat install) so the manifest exists.
3. Move unique files into `.cursor/` if they only lived under `agent-kit/`.
4. Delete the nested `agent-kit/` directory (including `node_modules` if present).
5. Run `agent-kit diff` / `status` to confirm.

Step-by-step migration: [migrate-consumer.md](migrate-consumer.md). This document defines the **install contract** so new projects never start with a folder copy.

## Acceptance

- [x] Install path documented without nested monorepo
- [x] L0 includes `autogit/` at project root  
- [x] Root `install.md` and README point at CLI / this bootstrap
- [x] Migration runbook proven and documented
- [x] Registry-based dogfood deployment verified
