# Agent Kit

**Framework for AI-assisted development on long-running projects** — human-in-the-loop by design, for any AI-assisted IDE.

Agent Kit gives coding agents a structural harness: plans with trackable to-dos, context handoff between sessions, a persistent memory loop, and a staged git workflow with explicit human confirmation before anything reaches production.

## Principles

- **Human-in-the-loop.** Agents automate inside the fence; humans approve at the gates. Production promotion (`/git-prod`) always requires explicit confirmation.
- **Structure over improvisation.** Plan → handoff → staging → prod. Long conversations hand off state instead of losing it.
- **Output hygiene.** Chat stays in chat: commits, docs, and memory carry technical facts only — no agent metalanguage, no session narrative.
- **Structural core, opt-in stack.** The Core Pack (L0) covers handoff, memory loop, hygiene, docs standards, and the git workflow. Stack tooling (ClickUp, n8n, SQL, …) is installed on demand via `agent-kit add` — never as always-on rules.

## Install

Do **not** copy this monorepo into your project. From the project root:

```bash
npx @agent-kit/cli install
# optional domain packs:
npx @agent-kit/cli install --pack clean-code,gestao-contexto
```

Chat alternative: attach [`install.md`](install.md) and ask the agent to install — same layout (L0 + manifest + `autogit/`).

Contract and layout: [docs/bootstrap.md](docs/bootstrap.md). Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## How it works

1. `/iniciar-projeto` — create a plan with trackable to-dos.
2. Work in the IDE; update to-do status as you go.
3. Context filling up? Handoff saves state to `.cursor/HANDOFF.md`.
4. New conversation → `/continuar-plano` — resume from the handoff.

**Continuous mode:** `/executar-plano-loop` runs ticks in-session and stages when there is a commit-ready diff. Never `/git-prod` inside the loop.

**Orchestrated mode:** `/executar-plano-orquestrado` keeps the main chat thin and dispatches workers per to-do. Without Task/subagents, fall back to loop or manual.

Plan modes: `autogit/plan-routine.md` (installed with L0).

## What install gives you (L0)

Minimum structural set — verified against the CLI L0 list:

| Kind | Contents |
|------|----------|
| Rules | plan-handoff, context-guardian, git-workflow, general, ux-tone, output hygiene, docs-professional-standard, memory-loop |
| Commands | `/iniciar-projeto`, `/continuar-plano`, `/executar-plano-loop`, `/executar-plano-orquestrado`, `/handoff`, `/resumo`, `/git-staging`, `/git-homolog` (legacy), `/git-prod` |
| Autogit | `autogit/gitupdate.md`, `autogit/plan-routine.md` |
| Hook | `.cursor/hooks/pre-commit/check-secrets.sh` |

Also written: `.cursor/agent-kit.json` (manifest). Session state (plans, HANDOFF, memory, context) is **L3** — local to the project, never overwritten by `update`.

ClickUp, n8n, SQL, language rules, and similar stack agents are **not** in L0. Add them with packs or skills:

```bash
npx @agent-kit/cli add <pack-or-skill>
```

Layers and packs: [docs/layers-spec.md](docs/layers-spec.md) · [docs/domain-packs.md](docs/domain-packs.md).

## CLI lifecycle

```bash
npx @agent-kit/cli install
npx @agent-kit/cli add <id>
npx @agent-kit/cli update    # re-apply L0/packs/skills; skips L3 protected paths
npx @agent-kit/cli diff
npx @agent-kit/cli status
npx @agent-kit/cli contribute   # propose upstream from local drift
```

Contribute guide: [docs/contribute-upstream.md](docs/contribute-upstream.md).

## Git spine (staging → production)

When the project uses staging before main:

- Never commit or push directly to `main`.
- **`/git-staging`** — work → `origin/staging` (branch, commit, MR/PR, merge). Legacy synonym: `git homolog`.
- **`/git-prod`** — approved staging → `origin/main` (explicit confirmation required).
- Conventional Commits (`feat:`, `fix:`, `docs:`, …).

Routines live in `autogit/gitupdate.md` after install.

## Docs

| Guide | Topic |
|-------|--------|
| [docs/getting-started.md](docs/getting-started.md) | Install, commands, workflow |
| [docs/bootstrap.md](docs/bootstrap.md) | Install without a nested kit folder |
| [docs/layers-spec.md](docs/layers-spec.md) | L0–L3 model |
| [docs/domain-packs.md](docs/domain-packs.md) | Seven L1 packs |
| [docs/agent-kit-manifest.md](docs/agent-kit-manifest.md) | `.cursor/agent-kit.json` |
| [docs/contribute-upstream.md](docs/contribute-upstream.md) | `agent-kit contribute` |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Contributing to this repo |
| [docs/README.md](docs/README.md) | Full docs index |

This monorepo is the SoT/registry (`packages/cli`, `registry/`, dogfood `.cursor/`). Consumers only get `.cursor/` + `autogit/` + the manifest.

## Security

The package ships no real project data. Keep `.cursor/HANDOFF.md` and Context Packs local (add to `.gitignore` if you do not want them versioned). The L0 pre-commit hook helps block secrets from being committed.
