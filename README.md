# Agent Kit

**Keep your AI coding agent on track across long projects — without losing context every time a chat gets too big.**

Long AI coding sessions fall apart. The context window fills up, the agent starts forgetting decisions you made an hour ago, and when you open a fresh chat to fix it, everything it learned about your project is gone.

Agent Kit fixes that. It gives your agent a place to write down what it's doing — the plan, the decisions, where it stopped — so you can close a bloated chat, open a new one, and pick up exactly where you left off. It also adds a safe git flow: the agent can commit and push to a staging branch on its own, but shipping to production always waits for your go-ahead.

Works with AI-assisted IDEs that read project rules from `.cursor/` (Cursor and compatible editors).

## Why you'd want it

- **You stop losing context.** Instead of scrolling back through a dead 200-message chat, the agent keeps a short state file. New chat, one command, and it's caught up.
- **The agent works against a plan.** Real to-dos you can watch tick off — not vibes. You always know what's done and what's next.
- **Production is never a surprise.** The agent can push to staging by itself; promoting to `main` always stops and asks you first.
- **Clean history.** Commits, docs, and notes describe the software — not "as an AI, I decided to…" chatter.
- **You install only what you use.** The base is small and generic. ClickUp, n8n, SQL helpers, language-specific rules — added on demand, never forced onto every project.

## Install

Run this in your project root (don't clone this repo into it):

```bash
npx @agent-kit/cli install
```

Prefer chat? Open your project in the IDE, drag in [`install.md`](install.md), and ask the agent to set it up — same result.

That's it. You now have a handful of slash commands and a small set of rules. Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## What it feels like to use

1. **Start a plan.** Run `/iniciar-projeto`. The agent turns your goal into a plan with checkable to-dos.
2. **Work normally.** The agent implements, ticking off to-dos as it goes. You watch progress in the plan panel.
3. **Chat getting long or sluggish?** Run `/handoff`. The agent writes down where things stand.
4. **Open a fresh chat** and run `/continuar-plano`. It reads the handoff and continues — no re-explaining.

Two hands-off modes for when you want less babysitting:

- `/executar-plano-loop` — the agent keeps working through the plan in the same chat and pushes to staging whenever there's something worth committing. It never promotes to production on its own.
- `/executar-plano-orquestrado` — for big plans: a lightweight main chat hands each to-do to a worker, keeping the main conversation clean.

## The git safety net

Agent Kit assumes a two-step flow so nothing lands in production by accident:

- **`/git-staging`** — the agent branches, commits (Conventional Commits), opens a PR, and merges into your staging branch. All on its own.
- **`/git-prod`** — promotes approved staging to `main`. This one **always stops and asks you to confirm** before touching production.

Direct commits to `main` are blocked by design. The full routine lives in `autogit/gitupdate.md` after install.

## What gets installed

The base install is deliberately small — the parts every long-running project benefits from:

- **Slash commands** for the whole loop: `/iniciar-projeto`, `/handoff`, `/continuar-plano`, `/executar-plano-loop`, `/executar-plano-orquestrado`, `/resumo`, `/git-staging`, `/git-prod`.
- **A few always-on rules** that keep the agent planning, handing off context, writing clean commits and docs, and following the git flow.
- **The git routine** (`autogit/`) and a **pre-commit hook** that blocks secrets from being committed.
- **A manifest** (`.cursor/agent-kit.json`) so the kit knows what it installed and can update itself without touching your work.

Anything specific to your project — plans, handoffs, notes — stays local and is never overwritten by an update.

Need more? Add stack tooling explicitly:

```bash
npx @agent-kit/cli add clean-code
npx @agent-kit/cli add <skill-or-pack>
```

## Keeping it current

```bash
npx @agent-kit/cli status    # what's installed
npx @agent-kit/cli update    # pull the latest rules/commands; leaves your project files alone
npx @agent-kit/cli diff      # see what changed vs the latest
npx @agent-kit/cli add <id>  # add a skill or pack
```

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

This repo is the source of truth: the CLI (`packages/cli`), the registry of rules, skills, and packs (`registry/`), and a live copy of the kit used to build the kit itself. Projects that install Agent Kit receive only `.cursor/` + `autogit/` + the manifest — never this whole repo.

## A note on safety

Agent Kit ships no real project data. Your handoffs and notes live only in your repo (add `.cursor/HANDOFF.md` to `.gitignore` if you'd rather not track them), and the pre-commit hook helps stop secrets from slipping into a commit.
