# @dadado/agent-kit-cli

Agent Kit CLI: HITL operating-layer install and tooling for AI-assisted IDEs (rules, skills, plan/handoff, staging-to-prod, memory). It installs local workspace contracts; it is not a hosted control plane or graph workflow runtime.

## Install

From your project root (Node.js 20+):

```bash
npx @dadado/agent-kit-cli install
```

Unpinned `npx` resolves to the latest publish. Pin a version when you need a reproducible install:

```bash
npx @dadado/agent-kit-cli@x.y.z install
```

Optional L1 packs:

```bash
npx @dadado/agent-kit-cli install --pack clean-code,context-management
```

Install writes L0 kit files under `.cursor/`, plus `autogit/` and `.cursor/agent-kit.json`. It does not copy the Agent Kit monorepo into your project.

After install, in Cursor run `/agent-kit-onboard`, then `/start-project` when you have a deliverable.

## Mission Control

From package version **4.8.2** onward, this npm package includes Mission Control panel assets under `dashboard/`. In a consumer workspace after install:

```bash
agent-kit dashboard
```

The panel binds to loopback by default, serves its own static files, and snapshots the current workspace. L0 install does **not** copy `dashboard/` into your app; `agent-kit dashboard` resolves the panel from the installed package.

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

Subcommands and `agent-kit --version` are unchanged. Chat-only HITL flows (`/start-project`, `/git-staging`, `/git-prod`, `/run-plan-all`, backlog CRUD) are not CLI commands.

## Common commands

| Command | Purpose |
|---------|---------|
| `agent-kit install` | Bootstrap L0 (+ optional packs) and write `agent-kit.json` |
| `agent-kit status` | Show installed kit version and profile |
| `agent-kit doctor` | Diagnose repository readiness |
| `agent-kit update` | Re-apply L0/packs/skills from the registry |
| `agent-kit dashboard` | Start Mission Control for this workspace |
| `agent-kit add <id>` | Install a skill or L1 pack |
| `agent-kit run-plan` | Headless continuous plan runner (never promotes to production) |

Run `agent-kit --help` or `agent-kit <command> --help` for the full surface.

## Docs

- Public repository and guides: https://github.com/agent-kit-startup/agent-kit
- Install contract (chat / no-CLI fallback): https://raw.githubusercontent.com/agent-kit-startup/agent-kit/main/install.md
- Getting started: https://github.com/agent-kit-startup/agent-kit/blob/main/docs/getting-started.md
