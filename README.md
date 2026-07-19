# Agent Kit

**Turn your AI coding agent into one that runs the whole workflow: plan it, build it, ship it, and remember it across long projects.**

Long AI coding sessions fall apart when the context window fills up. Agent Kit fixes this with a small operating layer that handles planning, handoff between chats, and structured git flow. The agent builds against a checkable plan and writes down where it stopped so any fresh chat picks up exactly where the last one left off.

## Why you'd want it

- **No more lost context.** The agent keeps a short state file; new chat, one command, and it's caught up.
- **Work against real plans.** To-dos you can watch tick off, not vibes.
- **Built-in DevOps discipline.** Staging-first git flow prevents history chaos.
- **Production needs confirmation.** Agent can push to staging alone; promoting to `main` always asks first.
- **Clean history everywhere.** Commits and docs describe the software, not chat chatter.

## Install

Run this in your project root (don't clone this repo into it):

```bash
npx @agent-kit/cli install
```

Prefer chat? Open your project in the IDE, drag in [`install.md`](install.md), and ask the agent to set it up - same result.

That's it. You now have a handful of slash commands and a small set of rules. Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## Usage

1. **Start a plan:** `/start-project` - agent turns your goal into checkable to-dos.
2. **Work one phase:** agent implements the current phase, updates handoff, and stops.
3. **Continue later:** `/continue-plan` in a fresh chat picks up where you left off.
4. **Ship to staging:** `/git-staging` - branches, commits, merges automatically.

Optional hands-off modes: `/run-plan-loop` (same chat) or `/run-plan-orchestrated` (worker delegation).

**Production safety:** `/git-prod` promotes staging to `main` but always asks for confirmation first. Direct commits to `main` are blocked.

Full routine: `autogit/gitupdate.md` after install.

## Docs

| Guide | What's in it |
|-------|--------------|
| [Getting started](docs/getting-started.md) | Install, commands, day-to-day workflow |
| [Bootstrap](docs/bootstrap.md) | Exactly what lands in your project, and why there's no nested folder |
| [Layers](docs/layers-spec.md) | How the base install, optional packs, and your local files layer together |
| [Domain packs](docs/domain-packs.md) | Optional bundles: clean code, DevOps, testing, and more |
| [Manifest](docs/agent-kit-manifest.md) | The `.cursor/agent-kit.json` file |
| [Contributing](docs/CONTRIBUTING.md) | Working on the kit itself |
| [Docs index](docs/README.md) | Everything else |

## For maintainers

This repo is the source of truth and dogfood workspace. Projects that install Agent Kit receive only `.cursor/` + `autogit/` + the manifest, never this whole repo. Your handoffs and notes live only in your project; the pre-commit hook helps stop secrets from being committed.
