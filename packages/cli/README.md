# @dadado/agent-kit-cli

[![npm version of @dadado/agent-kit-cli](https://img.shields.io/npm/v/%40dadado%2Fagent-kit-cli?label=npm&color=0C8DEB)](https://www.npmjs.com/package/@dadado/agent-kit-cli)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-blue)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![Latest release of the public agent-kit repository](https://img.shields.io/github/v/release/agent-kit-startup/agent-kit?label=release&color=00D0E7)](https://github.com/agent-kit-startup/agent-kit/releases/latest)

<img src="https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/dashboard/logo.svg" alt="Mission Kit helmet mark" width="120">

Agent Kit CLI: HITL operating-layer install and tooling for AI-assisted IDEs (rules, skills, plan/handoff, staging-to-prod, memory). It installs local workspace contracts; it is not a hosted control plane or graph workflow runtime.

## Install

From your project root (Node.js 20+):

```bash
npx @dadado/agent-kit-cli@latest install
```

Use `@latest` so npx does not reuse a stale cached CLI. Pin a version when you need a reproducible install:

```bash
npx @dadado/agent-kit-cli@x.y.z install
```

Optional L1 packs:

```bash
npx @dadado/agent-kit-cli@latest install --pack clean-code,context-management
```

Install writes L0 kit files under `.cursor/`, plus `autogit/` and `.cursor/agent-kit.json`. It does not copy the Agent Kit monorepo into your project.

After install, in Cursor run `/agent-kit-onboard`, then `/start-project` when you have a deliverable.

## Mission Control

From package version **4.8.2** onward, this npm package includes Mission Control panel assets under `dashboard/`. In a consumer workspace after install:

```bash
agent-kit dashboard
```

The panel binds to loopback by default, serves its own static files, and snapshots the current workspace. L0 install does **not** copy `dashboard/` into your app; `agent-kit dashboard` resolves the panel from the installed package.

Browser-free: `agent-kit mission-control` is a third surface (ASCII Mission, Flight Log, Checklist, Crew Monitor) that reuses the same snapshot builders without starting the HTTP server. `agent-kit mission-control --once` prints one frame (Claude Code `/agent-kit`). The web dashboard stays shipped.

Older tags before 4.8.2 do not include those assets. Prefer a current pin, or point `MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME` at an agent-kit checkout that contains `dashboard/`.

## Bare invoke (welcome)

With no subcommand, `agent-kit` prints a branded Mission Kit welcome (ASCII helmet, version, and short utility hints) then exits. Technical identifiers stay `agent-kit` / `@dadado/agent-kit-cli`.

```bash
agent-kit
# → welcome + hints (doctor, status, dashboard, init, --help)

agent-kit --help
# → grouped command list (SETUP / MISSION / DASHBOARD / INTEGRITY)

NO_COLOR=1 agent-kit
# → plain text (no ANSI); also plain when stdout is not a TTY or CI=1
```

Subcommands and `agent-kit --version` are unchanged. `agent-kit run <slash>` starts those project slashes headless from `.cursor/commands/` (numbered-list HITL). `agent-kit run-plan-all` is a first-class alias of `agent-kit run run-plan-all`. Typing `/run-plan-all` in zsh is a filesystem path. `/git-prod` and `/kit-prod` stay operator-gated and are omitted from that catalog. Factory `/kit-staging` is not a catalog slash either (factory disk / landing wraps only).

On an interactive TTY, long-running commands (`init`, `install`, `doctor`, `update`, `run-plan` ticks) show an in-process ANSI spinner plus a rotating Mission Kit tip. Set `AGENT_KIT_REDUCED_MOTION=1` for static text on a capable TTY. Runtime dependencies stay `@clack/prompts`, `citty`, and `kolorist` (no `ora` / `figlet` / `chalk` / `ink`). Window titles for `agent-kit dashboard` and `agent-kit dashboard-broadcast` use the workspace basename, not the CLI package folder.

## Common commands

| Command | Purpose |
|---------|---------|
| `agent-kit install` | Bootstrap L0 (+ optional packs) and write `agent-kit.json` |
| `agent-kit status` | Show installed kit version and profile |
| `agent-kit doctor` | Diagnose repository readiness (`--json` includes an `env` pillar: bin-on-PATH, npm prefix writability, Node version, shell profile) |
| `agent-kit setup-global` | Self-heal a root-owned npm global prefix (relocate to `~/.npm-global`, fix `PATH`, reinstall) |
| `agent-kit update` | Re-apply L0/packs/skills from the registry |
| `agent-kit dashboard` | Start Mission Control for this workspace (browser panel) |
| `agent-kit mission-control` | ASCII Mission Control TUI (`--once` for one frame) |
| `agent-kit add <id>` | Install a skill or L1 pack |
| `agent-kit run <slash>` | One headless session from an L0 slash file (numbered-list HITL; never git-prod) |
| `agent-kit run-plan` | Headless continuous plan runner (never promotes to production) |
| `agent-kit run-plan-all` | Headless `/run-plan-all` queue from the L0 file (same as `run run-plan-all`; never git-prod) |

Run `agent-kit --help` or `agent-kit <command> --help` for the full surface.

## Docs

- Public repository and guides: https://github.com/agent-kit-startup/agent-kit
- Install contract (chat / no-CLI fallback): https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install.md
- Getting started: https://github.com/agent-kit-startup/agent-kit/blob/main/docs/getting-started.md
