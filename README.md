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

### In Cursor (recommended)

Open your project in Cursor and copy-paste this into chat:

```
You are the installer for Agent Kit L0. Please confirm the absolute workspace root path via Ask questions before any write operations. If Node.js and npx are available, run `npx @dadado/agent-kit-cli install` in the confirmed root directory. Otherwise, fetch the install contract from https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install.md and follow the Port B instructions. Detect missing Node.js or git and inform the user if either is unavailable. Handle existing `.cursor/` directories appropriately. After successful installation, run or offer `/onboard` (first-install gates; SoT: `.cursor/commands/onboard.md`, install.md §6) using Ask questions for confirmations (chat fallback when tool unavailable). On Create first plan, proceed to `/start-project`; do not skip `/onboard` and jump only to `/start-project`.
```

> **Source:** [install-prompt.md](install-prompt.md) - Copy from raw URL: https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install-prompt.md

### In the terminal

Run from your project root:

```bash
npx @dadado/agent-kit-cli install
```

That's it. You now have a handful of slash commands and a small set of rules. Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## Usage

1. **First-time setup:** `/onboard` - welcome and command introduction (then `/start-project` when you have a goal).
2. **Start a plan:** `/start-project` - Broad Intake Review, propose/write the plan first, then run the first to-do only after you confirm.
3. **Work one phase:** agent implements the current phase, updates handoff, and stops.
4. **Continue later:** `/continue-plan` in a fresh chat picks up where you left off.
5. **Ship to staging:** `/git-staging` - branches, commits, merges automatically.

Two ways to drive a plan:

- **`/continue-plan`** - you drive: one phase per chat, the agent stops and waits between units.
- **`/run-plan`** - it drives: the agent works through the plan to the end, checking off to-dos and pushing each finished topic to staging. It picks the best execution strategy itself (worker delegation when available, same-chat loop otherwise). Optional external plan review via Claude Code provides post-completion gap detection.

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
| [Contributing](docs/CONTRIBUTING.md) | Working on the kit itself (includes contributor quickstart) |
| [Docs index](docs/README.md) | Everything else |

## For maintainers

Two GitHub repos, one product:

| Repo | Role |
|------|------|
| [agent-kit-dev](https://github.com/agent-kit-startup/agent-kit-dev) (private) | Factory: CLI, sync tooling, dogfood. Daily flow: `git staging` → `git prod` → allowlist sync. |
| [agent-kit](https://github.com/agent-kit-startup/agent-kit) (public) | Storefront and **canonical registry** (`registry/**`). Consumers install from here; registry PRs land here. |

Projects that install Agent Kit receive only `.cursor/` + `autogit/` + the manifest, never the whole monorepo.

**Three layers:** local scratch (HANDOFF/plans, gitignored) · private Git (factory) · public (storefront + registry SoT). Full cheat sheet: [docs/repository-boundaries.md](docs/repository-boundaries.md#cheat-sheet-three-layers).
