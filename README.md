# Mission Kit

[Watch the demo on YouTube](https://www.youtube.com/watch?v=9mrAg6Mczfg) · [missionkit.io](https://missionkit.io)

**Development operations built into Cursor and VS Code.**

Mission Kit 5 is a free, source-available framework under [PolyForm Noncommercial](https://polyformproject.org/licenses/noncommercial/1.0.0). It adds project management, DevSecOps discipline, and agent orchestration so you can plan, build, review, and ship without leaving the IDE. Install and CLI packages still use the Agent Kit identifiers (`npx @dadado/agent-kit-cli`, `agent-kit`, `/agent-kit-onboard`). Commercial use: [sales@missionkit.io](mailto:sales@missionkit.io).

Formerly **agent-kit**. Same toolkit, clearer product name.

Long AI coding sessions fall apart when the context window fills up. Mission Kit keeps work on a checkable plan, saves where you stopped, and lets any fresh chat pick up cleanly. Confirmations stay human-in-the-loop, not unchecked autonomy.

## Why you'd want it

- **No more lost context.** State travels with the repo; a new chat catches up with one command.
- **Work against real plans.** To-dos you can watch tick off. Autonomy stays optional and gated.
- **Built-in DevOps discipline.** Staging-first git flow keeps history clean.
- **Production needs confirmation.** Staging can run on autopilot; promoting to `main` always asks first.
- **Learnings that stick.** Resolved errors and decisions stay in the workspace for the next chat. Nothing retrains the model.
- **Clean history.** Commits and docs describe the software, not chat chatter.

## What you get

| Capability | In practice |
|------------|-------------|
| **Plans with human gates** | `/start-project` reviews context, writes a plan, then runs the first unit only after you confirm. |
| **Resume across chats** | Finish a phase, open a fresh chat, run `/continue-plan`. Native hooks help the agent reload state. |
| **Manual or continuous run** | Drive one phase at a time (`/continue-plan`), let a plan run to the end (`/run-plan`), or queue several (`/run-plan-all`). |
| **Staging → production git** | `/git-staging` promotes to `origin/staging`. `/git-prod` reaches `main` only after explicit confirmation. |
| **Repository readiness** | Install scans the repo and applies safe local fixes. `/agent-kit-onboard` walks remaining decisions before planning. |
| **Optional external review** | After a plan finishes, arm a second-pass gap check and triage findings. Opt-in via config. |
| **Skills and packs** | Registry skills and optional packs (clean code, context tools, and more). Update via CLI; contribute upstream with `agent-kit contribute`. |
| **Mission Control** | Local dashboard over workspace runtime state (loopback by default). |

Deep dives: [getting started](docs/getting-started.md), [five-layer claim matrix](docs/five-layer-claim-matrix.md), [external plan review](docs/external-plan-review.md), [domain packs](docs/domain-packs.md), [personas](docs/personas-contract.md).

## Install

### In Cursor (recommended)

Open your project in Cursor and paste this into chat:

```
You are the installer for Agent Kit L0. Confirm the absolute workspace root path via Ask questions before any write operations. If Node.js and npx are available, run `npx @dadado/agent-kit-cli install` in the confirmed root directory. Otherwise, fetch the install contract from https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install.md and follow the Port B instructions. Detect missing Node.js or Git and report either prerequisite. Preserve existing `.cursor/` content. After successful installation, run or offer `/agent-kit-onboard` (SoT: `.cursor/commands/agent-kit-onboard.md`, install.md section 6). Use Ask questions for unresolved readiness choices and confirmations, with chat fallback when unavailable. Do not ask about skins, external review, or a first deliverable before essential readiness passes.
```

> **Source:** [install-prompt.md](install-prompt.md) · Raw: https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install-prompt.md

### In the terminal

From your project root:

```bash
npx @dadado/agent-kit-cli install
```

Unpinned `npx` resolves to the latest publish. Pin when you need a reproducible install: `npx @dadado/agent-kit-cli@x.y.z install`.

That installs slash commands and a small set of rules into the project. Walkthrough: [docs/getting-started.md](docs/getting-started.md).

## Usage

1. **Prepare the repository:** `/agent-kit-onboard` - readiness, safe fixes, one decision at a time.
2. **Start a plan:** `/start-project` - describe a goal; confirm the plan, then the first unit.
3. **Work a phase:** the agent implements, saves resume state, and stops (manual mode).
4. **Continue later:** `/continue-plan` in a fresh chat.
5. **Ship to staging:** `/git-staging` - branch, commit, merge to `origin/staging`.

How to drive a plan:

- **`/continue-plan`** - you drive: one phase per chat.
- **`/run-plan`** - the kit drives: runs the plan to the end and stages finished work.
- **`/run-plan-all`** - queue several plans and run them in order after you confirm the queue.

Short chooser: [Getting started](docs/getting-started.md#which-command-next).

**Production safety:** `/git-prod` promotes staging to `main` only after confirmation. Direct commits to `main` are blocked.

### Mission Control (local dashboard)

Mission Control is a local panel over Mission Kit runtime state. It binds to loopback by default and serves only its own static files. It is a cockpit for one workspace, not a hosted multi-tenant control plane.

```bash
npx @dadado/agent-kit-cli dashboard
```

```bash
# Opt-in LAN broadcast (token-gated)
npx @dadado/agent-kit-cli dashboard-broadcast
```

`npx` is ephemeral: it never leaves an `agent-kit` bin on your `PATH`. Run `npm i -g @dadado/agent-kit-cli` once if you prefer the bare `agent-kit dashboard` form.

Open the **printed** URL if the browser did not open (with `PORT` unset, each workspace gets a stable port in `3333–3588`; do not assume `:3333`). In Cursor chat, `/dashboard` starts the same flow.

**If the `dashboard` subcommand says no `dashboard/start.mjs`:** upgrade or pin `@dadado/agent-kit-cli@4.8.2` or newer, or set `MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME`. Install does not copy `dashboard/` into your app tree.

More: [Getting started - Mission Control](docs/getting-started.md#mission-control-production-ship-constraints) · [consumer configuration](docs/consumer-configuration.md).

## Docs

| Guide | What's in it |
|-------|--------------|
| [Getting started](docs/getting-started.md) | Install, commands, day-to-day workflow |
| [Five-layer claim matrix](docs/five-layer-claim-matrix.md) | Public positioning (core / optional / planned / unsupported) |
| [Repository readiness](docs/repository-readiness-onboarding.md) | Install discovery and `/agent-kit-onboard` |
| [Bootstrap](docs/bootstrap.md) | What lands in your project |
| [Domain packs](docs/domain-packs.md) | Optional skill packs |
| [Agent Personas](docs/personas-contract.md) | Mode-aware chat chrome |
| [External plan review](docs/external-plan-review.md) | Opt-in post-plan gap monitor |
| [Manifest](docs/agent-kit-manifest.md) | `.cursor/agent-kit.json` |
| [Contributing](docs/CONTRIBUTING.md) | Working on the kit |
| [Development](docs/DEVELOPMENT.md) | Factory topology and maintainer workflows |
| [Docs index](docs/README.md) | Everything else |

## Licensing

Mission Kit (Agent Kit) is source-available under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) (see [LICENSE](LICENSE)).

- Free for personal, non-commercial use under PolyForm Noncommercial.
- Commercial use, distribution, or embedding in a commercial product requires a separate commercial license.
- Companies: contact [sales@missionkit.io](mailto:sales@missionkit.io).

## Contribute

Want to improve skills, docs, or the CLI? Start at [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). Factory and sync details live in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Participation is covered by the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Stuck or unsure where to ask? [Support](.github/SUPPORT.md). Found a vulnerability? Do not open an issue - follow the [security policy](.github/SECURITY.md).
