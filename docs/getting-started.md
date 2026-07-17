# Getting Started

Agent Kit understands your project, generates IDE-specific setup, and keeps your context across sessions. Here's how to use it.

## End-user install (no nested kit folder)

```bash
npx @agent-kit/cli install
```

This writes **L0** into `.cursor/` + `autogit/`, plus `.cursor/agent-kit.json`. Do **not** copy the Agent Kit monorepo into the project. Full contract: [bootstrap.md](bootstrap.md).

Chat alternative: attach root [`install.md`](../install.md) and ask the agent to install (same layout).

Optional packs:

```bash
npx @agent-kit/cli install --pack clean-code,gestao-contexto
```

Scan + wizard (generators) remains available as:

```bash
npx @agent-kit/cli init
```

## Development (this monorepo)

1. Install dependencies: `pnpm install`
2. Build CLI: `pnpm build`
3. Run scanner: `pnpm --filter @agent-kit/cli start scan`
4. Install into a project: `pnpm --filter @agent-kit/cli start install --cwd /path/to/project`
5. Dogfood here: `pnpm --filter @agent-kit/cli start status`

## Commands

| Command | What it does |
|---------|-------------|
| `agent-kit init` | Scan + wizard + generate setup + install core skills |
| `agent-kit install [profile]` | Bootstrap L0 (+ optional `--pack` list) from registry; writes `.cursor/agent-kit.json` |
| `agent-kit scan` | Run scanner only |
| `agent-kit add <id>` | Install a skill or L1 pack from registry (`--skill` / `--pack` if ids collide) |
| `agent-kit status` | Distribution status (version, packs, L3 protected); `--json` for raw dump |
| `agent-kit update` | Re-apply L0/packs/skills from registry; **never** overwrites L3 protected paths |
| `agent-kit diff` | Drift between installed artifacts and registry (`--all` includes matches) |
| `agent-kit contribute` | Propose upstream PR from local drift/new artifacts (anti-slop gate; `--write` copies into kit checkout) |
| `agent-kit handoff` | Read active plan, save progress to `.cursor/HANDOFF.md`, suggest routines |

## Workflow for long projects

Agent Kit helps you develop without losing context. **Always start from a plan** with to-dos in the frontmatter — that panel is how you track status.

1. `/iniciar-projeto` — create a plan with to-dos
2. Work on tasks (each sized for ~50% of context window), updating to-do `status` as you go
3. `/handoff` after each task — saves state, suggests git staging/prod
4. New conversation → `/continuar-plano` — reads HANDOFF and resumes

**Continuous mode:** `/executar-plano-loop` runs ticks in the same session, updates plan to-do status each tick, and runs `/git-staging` when there is a commitable diff. Never `/git-prod` inside the loop (HITL).

**Orchestrated mode:** `/executar-plano-orquestrado` keeps the main chat thin — it dispatches a Task/worker per to-do, checks a short summary, updates HANDOFF, and stages if needed. Without Task/subagents, degrade to loop or `/continuar-plano`.

See `autogit/plan-routine.md` for manual vs loop vs orchestrated modes. See root **README** for the full overview.
