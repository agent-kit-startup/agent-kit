# Getting Started

Agent Kit keeps your AI coding agent working against a plan and stops you from losing context when a chat gets too long. This guide covers installing it, the commands you get, and how a normal day looks.

## Install

Run this in your project's root folder:

```bash
npx @agent-kit/cli install
```

That's the whole install. It drops a small set of rules and slash commands into `.cursor/`, a git routine into `autogit/`, and a manifest (`.cursor/agent-kit.json`) that records what was installed so the kit can update itself later without touching your work.

Want a few extra bundles up front? Add packs (clean code, context tools, and more — see [domain packs](domain-packs.md)):

```bash
npx @agent-kit/cli install --pack clean-code,gestao-contexto
```

**Prefer not to use the CLI?** Open your project in the IDE, drag in the root [`install.md`](../install.md), and ask the agent to install. You get exactly the same result.

> Don't clone the Agent Kit repo into your project. Installing writes only the files your project needs — see [bootstrap](bootstrap.md) for the exact layout.

There's also a guided setup that scans your project and asks a few questions before installing:

```bash
npx @agent-kit/cli init
```

## The commands you get

| Command | What it does |
|---------|-------------|
| `agent-kit install [profile]` | Install the base kit into your project (add packs with `--pack`) |
| `agent-kit init` | Guided setup: scan your project, ask a few questions, then install |
| `agent-kit add <id>` | Add one skill or pack later |
| `agent-kit status` | Show what's installed (version, packs, protected files) |
| `agent-kit update` | Pull the latest rules and commands; leaves your own files alone |
| `agent-kit diff` | Show what changed between what you have and the latest |
| `agent-kit contribute` | Send an improvement you made locally back upstream |
| `agent-kit handoff` | Save your progress to `.cursor/HANDOFF.md` |
| `agent-kit scan` | Just scan the project, don't install |

## A normal day

The idea is simple: work against a plan, and save your place before a conversation gets too big to think straight.

1. **`/iniciar-projeto`** — the agent turns your goal into a plan with checkable to-dos. Everything starts from a plan; that panel is how you both track what's done and what's next.
2. **Work.** The agent implements a to-do at a time and checks them off. Keep each task roughly within half of the chat's context window so the agent stays sharp.
3. **`/handoff`** — when the chat is getting long, the agent writes down where things stand (and suggests pushing to staging if there's something worth committing).
4. **New chat → `/continuar-plano`** — it reads the handoff and continues, without you re-explaining the project.

### Less babysitting

- **`/executar-plano-loop`** — the agent keeps working through the plan in the same chat, checking off to-dos and pushing to staging when there's something to commit. It never promotes to production on its own.
- **`/executar-plano-orquestrado`** — for big plans: a lightweight main chat hands each to-do to a separate worker, keeping the main conversation from filling up. If your setup has no worker support, it falls back to the loop or manual mode.

The exact git steps behind staging and production live in `autogit/gitupdate.md`; plan modes in `autogit/plan-routine.md`. Both are installed with the kit.

## Working on Agent Kit itself

If you're developing the kit (not just using it):

1. Install dependencies: `pnpm install`
2. Build the CLI: `pnpm build`
3. Try the scanner: `pnpm --filter @agent-kit/cli start scan`
4. Install into a test project: `pnpm --filter @agent-kit/cli start install --cwd /path/to/project`
5. Check this repo's own install: `pnpm --filter @agent-kit/cli start status`

See the root [README](../README.md) for the big picture and [CONTRIBUTING](CONTRIBUTING.md) for how changes flow.
