# Agent Kit

[Watch the demo on YouTube](https://www.youtube.com/watch?v=9mrAg6Mczfg)

**Turn your AI coding agent into one that runs the whole workflow: plan it, build it, ship it, and remember it across long projects.**

Long AI coding sessions fall apart when the context window fills up. Agent Kit fixes this with a small operating layer that handles planning, handoff between chats, and structured git flow. The agent builds against a checkable plan and writes down where it stopped so any fresh chat picks up exactly where the last one left off.

## Why you'd want it

- **No more lost context.** The agent keeps a short state file; new chat, one command, and it's caught up.
- **Work against real plans.** To-dos you can watch tick off, not vibes. Confirmations stay human-in-the-loop (Ask questions), not unchecked autonomy.
- **Built-in DevOps discipline.** Staging-first git flow prevents history chaos.
- **Production needs confirmation.** Agent can push to staging alone; promoting to `main` always asks first.
- **Operational learning, not model training.** Memory and optional external review keep findings durable across chats; they do not retrain the model.
- **Clean history everywhere.** Commits and docs describe the software, not chat chatter.

## Features

| Feature | What you get |
|---------|----------------|
| **Plans + HITL gates** | `/start-project` Broad Intake, then two gates (write plan, then first unit). Confirmations use Ask questions (clickable options; chat fallback when the tool is unavailable). |
| **Phase handoff** | `.cursor/HANDOFF.md` plus Context Guardian and native hooks (`sessionStart` / `preCompact`) so a fresh chat resumes without re-briefing. Local workspace state; not a hosted sync plane. |
| **Manual or continuous run** | `/continue-plan` (one phase per chat) or `/run-plan` (runs to the end; picks worker orchestration or in-session loop; headless via `agent-kit run-plan`). `/run-plan-all` queues multiple plans sequentially. Plan/queue orchestration, not a general graph runtime. |
| **Staging → prod git** | `/git-staging` for automatic promote to `origin/staging`; `/git-prod` only after explicit confirmation. Direct commits to `main` are blocked. |
| **Memory loop** | Resolved errors and tradeoff decisions in `.cursor/memory/` so the next chat can reuse them. |
| **Repository readiness** | Install scans the repo, applies safe local fixes, and writes a readiness snapshot. `/agent-kit-onboard` resolves remaining decisions one at a time before `/start-project`. |
| **Agent Personas** | Mode-aware chat/CLI chrome only: Autopilot (`/continue-plan`), Night Shift (`/run-plan`), Ghost Runner (CLI). Configure after readiness or set `agentPersona` in `.cursor/context/config.json`. Never changes commits, HANDOFF, memory, or product docs. |
| **Optional external plan review** | After a plan is exhausted, arm Claude Code for a gap monitor; triage with `/plan-review-triage`. Opt-in via config. Findings-only by default (no silent product auto-fix). |
| **Skills + domain packs** | Registry skills and optional L1 packs (clean code, context tools, and more). Install/update via CLI; contribute upstream with `agent-kit contribute`. |
| **Output hygiene** | Chat can be light; commits, docs, HANDOFF, and memory stay professional and inheritable. |

### Production-agent layers (L0)

How the kit maps to a five-layer production-agent lens. Classifications and public evidence anchors: [five-layer claim matrix](docs/five-layer-claim-matrix.md). Documentation alone is not proof of behavior.

| Layer | What ships in core | Explicit non-claim |
|-------|--------------------|--------------------|
| Prompt + HITL | Plan gates, Ask questions, `/git-prod` confirmation | Not full autonomy without review |
| Context + memory | HANDOFF, hooks, memory loop, personas (chrome only) | Not a hosted control plane or cloud HANDOFF sync |
| Safeguards | Staging-first git, shell/secrets hooks, output hygiene | Not a guarantee that every install is production-ready |
| Iterative review | Opt-in external monitor, triage, Field Report cadence | Not autonomous model self-improvement |
| Workflow coordination | `/run-plan`, `/run-plan-all`, headless CLI, local Mission Control | Not a general graph / DAG engine |

Released consumer lane (npm / public GitHub) is version-qualified separately from private staging. Pin or check `@dadado/agent-kit-cli` when you need a reproducible floor.

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

**Mission Control** is a local panel over the Agent Kit runtime state. It binds to loopback by default and serves only its own static files. It is a cockpit for one workspace, not a hosted multi-tenant control plane. Actions stay copy-only (clipboard + paste destination). The Config section is a narrow exception: it may merge allowlisted session prefs into `.cursor/context/config.json` via loopback `PUT`/`PATCH /api/config` (no git, process, or prod mutations). Opt-in LAN: `/dashboard-broadcast` (token-gated). Production-ship constraints: [Getting started - Mission Control production-ship constraints](docs/getting-started.md#mission-control-production-ship-constraints).

The panel source lives under `dashboard/` in this repository (and the public agent-kit tree). **L0 install does not copy `dashboard/` into your app.** The published CLI ships `dashboard/**` inside `@dadado/agent-kit-cli` from 4.8.2 onward, so `agent-kit dashboard` resolves the panel from the installed package and snapshots your workspace via `MISSION_CONTROL_REPO_ROOT`. On 4.8.0 or an older pin the panel assets are absent: upgrade the CLI, or point it at a kit checkout (`MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME` / sibling `../agent-kit`).

```bash
# From a consumer workspace (snapshots this repo; UI from CLI package or kit host)
agent-kit dashboard

# From an agent-kit tree that includes dashboard/ — start (or reuse) and open the URL
npm run dashboard
# or: node dashboard/start.mjs
# Explicit consumer snapshot while serving from the kit tree:
# MISSION_CONTROL_REPO_ROOT=/path/to/consumer npm run dashboard

# Opt-in LAN broadcast (token-gated; prints LAN URL + token)
npm run dashboard:broadcast
# or: agent-kit dashboard-broadcast

# Foreground serve only (debugging; does not open a browser)
npm run start:dashboard
```

Then open the **printed** URL if the browser did not open (with `PORT` unset, each workspace gets a stable port in `3333–3588`; do not assume `:3333`). In Cursor chat, `/dashboard` does the same start-and-open flow via the IDE browser. For trusted LAN, use `/dashboard-broadcast` (never silent `HOST=0.0.0.0` without a token).

**If `agent-kit dashboard` says no `dashboard/start.mjs`:** the installed CLI is older than 4.8.2. (1) Upgrade or pin `@dadado/agent-kit-cli@4.8.2` or newer, or (2) set `MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME`, or (3) keep a sibling `../agent-kit` checkout. L0 alone never places the panel binary in your project tree.

The Cockpit reads as one page in four sections, each reachable from the primary navigation:

| Section | What it answers |
|---------|------------------|
| Current mission | The plan in flight: status, progress, friendly Mode labels, and previous/current/next todo |
| Flight Log | HANDOFF Gaps log (**NOW** / **Earlier**, wipe on new flight; cap 15 within a flight) plus operator Warnings (Quota pause, Heads up); palette-by-type notification chrome (`ok` / `advice` / `prompt` / `residual` / `warning`); clipboard icon; **one dynamically-labeled action button per entry** (composed prompt + document path; `Copy fix prompt` / `Copy recovery prompt` / `Copy follow-up prompt` / `Copy triage command`) with the toast naming the chat input as paste destination; **All clear** when idle (no literal `none` as a yellow NOW debit) |
| Checklist | What remains: recent plan cards, parked and incomplete plans, and readiness notes |
| Crew Monitor | Live agent/crew feed: ticks, handoffs, deliveries, and denser `agent_step` rows for active-plan to-dos (cap 20) |

Plans, Activity, Agents, Skills, Commands, Health, Git, Memory, Terminals, Processes, and Config live in the More sections menu next to those links, with their counts; tabs are deep-linkable via URL hash. Colored dots only signal state (good / important / attention) and are always paired with a label or icon; decorative dots are stripped. **Health** is a Healthcenter for the same seven workspace checks (`plans`, `handoff`, `agents`, `commands`, `memory`, `git`, `config`): vitals-style diagnosis cards, live severity, expand/detail per check, and per-problem Copy fix prompt CTAs plus Autofix/Fix controls that only copy a command or path and name where to paste it (chat, terminal, or file picker). Snapshot/serve errors are distinct from per-check fails. Health does not reorder main cockpit tabs and does not duplicate Checklist readiness.

Section highlights: **Config** is a grid form with Save pinned in a top actions bar, per-fieldset copy-snippet buttons for when the write path is unavailable, and dead-control hints (backend is claude-only; `updateApply.auto` never writable). The full consumer knob inventory lives in [docs/consumer-configuration.md](docs/consumer-configuration.md). **Memory** pairs a live recent-errors panel (from `.cursor/memory/errors/`) with green/red icon panels and an error-o-meter KPI strip (counts, rates, top tags). **Git** shows promotion flow lanes (work → staging → main, ahead/behind vs both), a readable commit graph, and staging-hygiene hints. **Commands**, **Skills**, and **Agents** are card grids with copy-only CRUD CTAs and lock badges on kit-managed items. **Plans** rows are status-aware (resume/run/edit/archive prompts) with a live progress bar from frontmatter to-do counts. **Processes** lists live processes with a generated per-process description of what each one is doing.

Every action copies text and names where to paste it: repo-relative paths go to the file picker, slash commands to the chat input, chat references to the past-chat picker, and shell commands, PIDs, and commit shas to the terminal. The panel cannot open a file or a chat, and no label claims it can.

Full routine: `autogit/gitupdate.md` after install.

## Docs

| Guide | What's in it |
|-------|--------------|
| [Five-layer claim matrix](docs/five-layer-claim-matrix.md) | Public five-layer positioning (core / optional / planned / unsupported) |
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
