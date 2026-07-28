# Agent Kit

**Turn your AI coding agent into one that runs the whole workflow: plan it, build it, ship it, and remember it across long projects.**

Long AI coding sessions fall apart when the context window fills up. Agent Kit fixes this with a small operating layer that handles planning, handoff between chats, and structured git flow. The agent builds against a checkable plan and writes down where it stopped so any fresh chat picks up exactly where the last one left off.

## Why you'd want it

- **No more lost context.** The agent keeps a short state file; new chat, one command, and it's caught up.
- **Work against real plans.** To-dos you can watch tick off, not vibes.
- **Built-in DevOps discipline.** Staging-first git flow prevents history chaos.
- **Production needs confirmation.** Agent can push to staging alone; promoting to `main` always asks first.
- **Clean history everywhere.** Commits and docs describe the software, not chat chatter.

## Features

| Feature | What you get |
|---------|----------------|
| **Plans + HITL gates** | `/start-project` Broad Intake, then two gates (write plan, then first unit). Confirmations use Ask questions (clickable options; chat fallback when the tool is unavailable). |
| **Phase handoff** | `.cursor/HANDOFF.md` plus Context Guardian and native hooks (`sessionStart` / `preCompact`) so a fresh chat resumes without re-briefing. |
| **Manual or continuous run** | `/continue-plan` (one phase per chat) or `/run-plan` (runs to the end; picks worker orchestration or in-session loop; headless via `agent-kit run-plan`). |
| **Staging → prod git** | `/git-staging` for automatic promote to `origin/staging`; `/git-prod` only after explicit confirmation. Direct commits to `main` are blocked. |
| **Memory loop** | Resolved errors and tradeoff decisions in `.cursor/memory/` so the next chat can reuse them. |
| **Repository readiness** | Install scans the repo, applies safe local fixes, and writes a readiness snapshot. `/agent-kit-onboard` resolves remaining decisions one at a time before `/start-project`. |
| **Agent Personas** | Mode-aware chat/CLI chrome only: Autopilot (`/continue-plan`), Night Shift (`/run-plan`), Ghost Runner (CLI). Configure after readiness or set `agentPersona` in `.cursor/context/config.json`. Never changes commits, HANDOFF, memory, or product docs. |
| **Optional external plan review** | After a plan is exhausted, arm Claude Code for a gap monitor; triage with `/plan-review-triage`. Opt-in via config. |
| **Skills + domain packs** | Registry skills and optional L1 packs (clean code, context tools, and more). Install/update via CLI; contribute upstream with `agent-kit contribute`. |
| **Output hygiene** | Chat can be light; commits, docs, HANDOFF, and memory stay professional and inheritable. |

Deep dives: [getting started](docs/getting-started.md), [personas contract](docs/personas-contract.md), [creating personas](docs/creating-personas.md), [external plan review](docs/external-plan-review.md), [domain packs](docs/domain-packs.md).

## Install

### In Cursor (recommended)

Open your project in Cursor and copy-paste this into chat:

```
You are the installer for Agent Kit L0. Confirm the absolute workspace root path via Ask questions before any write operations. If Node.js and npx are available, run `npx @dadado/agent-kit-cli install` in the confirmed root directory. Otherwise, fetch the install contract from https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install.md and follow the Port B instructions. Detect missing Node.js or Git and report either prerequisite. Preserve existing `.cursor/` content. After successful installation, run or offer `/agent-kit-onboard` (SoT: `.cursor/commands/agent-kit-onboard.md`, install.md section 6). Use Ask questions for unresolved readiness choices and confirmations, with chat fallback when unavailable. Do not ask about skins, external review, or a first deliverable before essential readiness passes.
```

> **Source:** [install-prompt.md](install-prompt.md) - Copy from raw URL: https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install-prompt.md

### In the terminal

Run from your project root:

```bash
npx @dadado/agent-kit-cli install
```

Unpinned `npx` resolves to the latest publish. Pin a version when you need a reproducible install: `npx @dadado/agent-kit-cli@x.y.z install` (replace `x.y.z` with a version from npm).

That's it. You now have a handful of slash commands and a small set of rules. Full walkthrough: [docs/getting-started.md](docs/getting-started.md).

## Usage

1. **Prepare the repository:** `/agent-kit-onboard` - progressive readiness (detect, safe fixes, one decision at a time). Completes only with verified essentials.
2. **Start a plan:** `/start-project` - after readiness, Broad Intake Review and two gates with Ask questions: (A) write plan file, (B) run first unit only after explicit confirmation.
3. **Work one phase:** agent implements the current phase, updates handoff, and stops.
4. **Continue later:** `/continue-plan` in a fresh chat picks up where you left off (Autopilot chat chrome by default).
5. **Ship to staging:** `/git-staging` - branches, commits, merges automatically.

Two ways to drive a plan:

- **`/continue-plan`** - you drive: one phase per chat, the agent stops and waits between units. Operator playbook: [Getting started - Manual playbook](docs/getting-started.md#manual-playbook-default).
- **`/run-plan`** - it drives: the agent works through the plan to the end, checking off to-dos and pushing each finished topic to staging (Night Shift chat chrome by default). It picks the best execution strategy itself (worker delegation when available, same-chat loop otherwise). Optional external plan review via Claude Code provides post-completion gap detection. Headless CLI ticks use Ghost Runner banners by default.
- **`/run-plan-all`** - Order and run multiple plans as a deduplicated queue (PO synthesis → confirm → execute). Pure orchestrator: after you confirm the queue, it dispatches one Task subagent per plan (each runs the `/run-plan` tick contract) instead of implementing in-window.

**Which command next?** Short chooser in [Getting started](docs/getting-started.md#which-command-next). Modes table: [plan-routine §5](autogit/plan-routine.md#5-two-execution-modes).

**Production safety:** `/git-prod` promotes staging to `main` but always asks for confirmation first. Direct commits to `main` are blocked.

### Dashboard

**Mission Control** is a local panel over the Agent Kit runtime state. It binds to loopback by default and serves only its own static files. Actions stay copy-only (clipboard + paste destination). The Config section is a narrow exception: it may merge allowlisted session prefs into `.cursor/context/config.json` via loopback `PUT`/`PATCH /api/config` (no git, process, or prod mutations). Opt-in LAN: `/dashboard-broadcast` (token-gated). Production-ship constraints: [Getting started - Mission Control production-ship constraints](docs/getting-started.md#mission-control-production-ship-constraints).

The panel lives under `dashboard/` in this repository (and the public agent-kit tree). A consumer project that only ran `npx @dadado/agent-kit-cli install` gets kit commands and `/dashboard` docs, not the `dashboard/` server files. Run the start commands from a checkout that contains `dashboard/start.mjs`.

```bash
# From an agent-kit tree that includes dashboard/ — start (or reuse) and open the URL
npm run dashboard
# or: agent-kit dashboard
# or: node dashboard/start.mjs

# Opt-in LAN broadcast (token-gated; prints LAN URL + token)
npm run dashboard:broadcast
# or: agent-kit dashboard-broadcast

# Foreground serve only (debugging; does not open a browser)
npm run start:dashboard
```

Then open `http://localhost:3333` if the browser did not open. In Cursor chat (same kit tree), `/dashboard` does the same start-and-open flow via the IDE browser. For trusted LAN, use `/dashboard-broadcast` (never silent `HOST=0.0.0.0` without a token).

The Cockpit reads as one page in four sections, each reachable from the primary navigation:

| Section | What it answers |
|---------|------------------|
| Current mission | The plan in flight: status, progress, friendly Mode labels, and previous/current/next todo |
| Crew Monitor | Live agent/crew feed: ticks, handoffs, deliveries, and denser `agent_step` rows for active-plan to-dos (cap 20) |
| Flight Log | HANDOFF Gaps log (**Live** / **Earlier**, wipe on new flight; cap 15 within a flight) plus operator Warnings (Quota pause, Heads up); clipboard icon; clickable copy text/path; **All clear** when idle |
| Checklist | What remains: recent plan cards, parked and incomplete plans, and readiness notes |

Plans, Activity, Agents, Skills, Commands, Health, Git, Memory, Terminals, Processes, and Config live in the More sections menu next to those links, with their counts.

Every action copies text and names where to paste it: repo-relative paths go to the file picker, slash commands to the chat input, chat references to the past-chat picker, and shell commands, PIDs, and commit shas to the terminal. The panel cannot open a file or a chat, and no label claims it can.

Full routine: `autogit/gitupdate.md` after install.

## Docs

| Guide | What's in it |
|-------|--------------|
| [Getting started](docs/getting-started.md) | Install, commands, day-to-day workflow |
| [Repository readiness](docs/repository-readiness-onboarding.md) | Install discovery, `/agent-kit-onboard`, and deliverable boundary |
| [Bootstrap](docs/bootstrap.md) | Exactly what lands in your project, and why there's no nested folder |
| [Layers](docs/layers-spec.md) | How the base install, optional packs, and your local files layer together |
| [Domain packs](docs/domain-packs.md) | Optional bundles: clean code, DevOps, testing, and more |
| [Agent Personas](docs/personas-contract.md) | Mode defaults, `agentPersona` config, hygiene boundary ([create / contribute](docs/creating-personas.md)) |
| [External plan review](docs/external-plan-review.md) | Opt-in Claude Code monitor after `/run-plan` exhaustion |
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
