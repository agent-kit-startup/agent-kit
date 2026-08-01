# Capability inventory

Agent Kit capability catalog grouped by surface family. Lists every shipped capability with one line per item.

**Status (2026-07-31):** Capability counts verified against the working tree on private `staging` @ `7e5315d` (package floor `4.8.4`). Normative intent lives in commands/rules/CLI; this catalog is **derived documentation** and is not proof of runtime behavior. Evidence lanes: `docs/evidence/artifact-ledger-summary.md`, `docs/evidence/delivery-reconciliation.json` (RC-003/RC-004). Five-layer README positioning claims: `docs/evidence/five-layer-claim-matrix.md`.

Real counts: 27 commands, 25 rules, 13 agents, 9 skills, 5 Cursor hooks, 18 CLI commands (plus 5 subsystems), 7 packs, 3 personas, Mission Control dashboard, Git hooks, root scripts, and auxiliary tooling. Positioning table below lists **25 unique paths / 89 literal rows** (see §Positioning surfaces) and is an open enumeration (not a closed surface census); the npm storefront `packages/cli/README.md` is a required surface.

---

## Slash commands (.cursor/commands/ - 27)

- `/start-project` - Plan creation with two-gate HITL (broad intake, write confirm, optional Gate B start unit)
- `/backlog-add` - Enqueue plan under HANDOFF Backlog without activation
- `/backlog-edit` - Edit backlog plan markdown after confirmation
- `/backlog-delete` - Remove from HANDOFF Backlog and archive plan file
- `/backlog-cancel` - Soft-cancel open to-dos, drop Backlog row, keep plan file
- `/agent-kit-onboard` - Repository readiness check with essential/non-essential pillars
- `/continue-plan` - Resume plan from HANDOFF state, confirm next unit, execute one phase
- `/run-plan` - Continuous execution mode with orchestrated or in-session loop strategies
- `/run-plan-loop` - In-session continuous execution without Task dispatch
- `/run-plan-orchestrated` - Task dispatch strategy for continuous execution
- `/run-plan-all` - Multi-plan queue orchestration with dispatched workers per plan
- `/hotfix` - Narrow urgent mini-plan with immediate run-plan execution
- `/handoff` - Manual context handoff with preference setting
- `/summary` - Session summary with takeaways
- `/dashboard` - Mission Control UI for plans, queue, monitors
- `/dashboard-broadcast` - Broadcast updates across Mission Control sessions
- `/tips` - UX helper tips for Agent Kit usage
- `/update` - Consumer-mode layer update from public registry
- `/cursor-update-awareness` - Advisory Cursor product-update check (changelog + inventory; HITL conveyor)
- `/git-staging` - Staging branch promotion with CHANGELOG and MR workflow
- `/git-prod` - Production promotion from staging with HITL confirmation
- `/plan-external-review` - External plan review launcher with audit modes
- `/plan-review-triage` - Triage choice after external review (residuals/fixes/ack)
- `/field-report-resolve` - Resolve Field Report findings with structured closure
- `/archive-plan` - Move parked plan to archive with status update
- `/context-status` - Context window and memory status report
- `/dogfood` - File a private dogfood note into the factory or consumer inbox

---

## Rules (.cursor/rules/ - 25)

### Core rules (always applied)
- `cursor-plan-handoff.mdc` - Multi-phase plan execution with HANDOFF contract
- `context-guardian.mdc` - Context window monitoring with automatic handoff
- `cursor-skills-git-workflow.mdc` - Staging-to-production Git flow enforcement
- `cursor-skills-general.mdc` - Base CURSOR-SKILLS principles and conventions
- `ux-tone.mdc` - Chat tone guidelines with persona chrome support
- `agent-output-hygiene.mdc` - Chat vs repository content separation
- `docs-professional-standard.mdc` - Project documentation voice and inheritance standard
- `memory-loop.mdc` - Cross-chat learning persistence in .cursor/memory/
- `hitl-ask-questions.mdc` - Human-in-the-loop confirmations via Ask questions tool
- `git-secrets-safety.mdc` - Git commit safety with secrets validation

### Stack rules (requestable)
- `cursor-skills-clickup.mdc` - ClickUp integration conventions
- `cursor-skills-n8n.mdc` - n8n workflow editing patterns
- `cursor-skills-api.mdc` - REST/GraphQL API development standards
- `cursor-skills-devops.mdc` - CI/CD and infrastructure guidance
- `cursor-skills-groovy.mdc` - Groovy syntax and integration rules
- `cursor-skills-integrations.mdc` - Webhooks, microservices, database patterns
- `cursor-skills-json.mdc` - JSON validation and formatting standards
- `cursor-skills-mobile.mdc` - React Native, Flutter, Expo development
- `cursor-skills-node.mdc` - Node.js, Express, NestJS, Next.js standards
- `cursor-skills-php.mdc` - PHP, Laravel, Symfony, WordPress conventions
- `cursor-skills-prompts.mdc` - Agent prompt creation and versioning
- `cursor-skills-python.mdc` - Python, Django, Flask, FastAPI standards
- `cursor-skills-sql.mdc` - SQL and database schema patterns
- `cursor-skills-testing.mdc` - Testing conventions and QA routines
- `cursor-skills-webdesign.mdc` - HTML, CSS, JavaScript, React standards

---

## Named subagents (.cursor/agents/ - 13)

- `cleancode-refactor` - Architecture and readability refactoring
- `clickup-tasks` - ClickUp task creation and management via MCP
- `context-librarian` - Working memory summarization and Context Pack management
- `docs-repo` - README, ADR, and repository documentation maintenance
- `git-autogit` - Staging-to-production Git workflow automation (dogfood-only)
- `json-guardian` - JSON validation and normalization (demoted to skill-first)
- `memory-extractor` - Cross-session learning extraction and deduplication
- `n8n-workflows` - n8n workflow editing and documentation (demoted to skill-first)
- `prompts-agents` - Agent prompt creation in Markdown (demoted to skill-first)
- `security-reviewer` - Security review for auth, PII, secrets, injection
- `sql-schema` - SQL schema creation and modification (demoted to skill-first)
- `tech-lead` - Technology decisions, ADRs, architecture tradeoffs
- `test-suites` - Test suite maintenance and E2E testing

---

## Skills (.cursor/skills/ - 9)

### Core skills (2)
- `clean-code` - AI code slop removal and clean patterns
- `docs-repo` - Repository documentation with professional standard

### Community skills (7)
- `clickup` - ClickUp task management via MCP
- `cursor-skills-node` - Node.js development standards
- `json-data-config` - JSON validation, formatting, manipulation
- `n8n-workflows` - n8n workflow creation and editing
- `prompts-markdown` - Agent prompt structure and versioning
- `sql-postgres` - PostgreSQL schema and query patterns
- `ux-message-flows` - Conversational UX for chat agents

---

## Cursor-native hooks (.cursor/hooks.json - 5)

- `sessionStart` - Session initialization with HANDOFF reading
- `preCompact` - Context window warning before compaction
- `beforeShellExecution` - Shell command validation and safety
- `afterFileEdit` - Schema validation after file edits
- `beforeSubmitPrompt` - Secrets detection before prompt submission

---

## CLI commands (packages/cli/src/commands/ - 18)

- `add` - Add new components to Agent Kit installation
- `contribute` - Contribution workflow helpers
- `cursor-awareness` - Advisory Cursor product-update awareness check (`cursorUpdateCheck`)
- `dashboard-broadcast` - Mission Control broadcast management
- `dashboard` - Mission Control UI server
- `diff` - Compare Agent Kit versions and changes
- `doctor` - Installation health check and diagnostics
- `guard` - Safety validation for various operations
- `handoff` - Context handoff utilities
- `hook` - Hook management and installation
- `init` - Initialize new Agent Kit installation
- `install` - Install Agent Kit components from registry
- `monitors` - Plan monitor management and status
- `run-plan` - Plan execution orchestration
- `scan` - Workspace scanning and analysis
- `status` - Agent Kit installation status
- `update` - Update Agent Kit from registry
- `validate` - Validation utilities for various formats

### CLI subsystems (5)

- Manifest system - Agent Kit installation tracking
- Registry system - Component distribution and versioning
- Dashboard system - Mission Control UI with React components
- Plan-loop system - Continuous execution orchestration
- Lifecycle system - L0-L3 layer management

---

## Mission Control sections (dashboard/dashboard.html - 12)

Top navigation carries the primary sections; the rest are reachable from the More menu.

- `overview` (Home) - Cockpit landing grouped into Now Execution, Attention, and Recent Plans
- `plans` - Active, backlog, parked, and archived plan management
- `activity` - Unified feed of plan, git, and audit events
- `agents` - Installed named subagents and their routing signals
- `commands` - Installed slash commands
- `skills` - Installed skills by layer
- `processes` - Running plan loops and background jobs
- `terminals` - Terminal session inspection
- `git` - Branch state, staging-to-production position, and recent commits
- `health` - Health Center checks and installation diagnostics
- `memory` - Errors, decisions, monitors, and audits from `.cursor/memory/`
- `config` - Settings, persona selection, and run-plan configuration

---

## Registry packs (registry/packs/ - 7)

- `clean-code` - Code quality and simplification tools
- `context-management` - Advanced context and memory tools
- `cybersec` - Security review and hardening tools
- `devops` - CI/CD and infrastructure tools
- `engineering-architecture` - ADRs and technical decision tools
- `project-management` - Optional PM tool integrations
- `quality` - Testing and QA workflow tools

---

## Agent personas (registry/personas/core/ - 3)

- `autopilot` - Cockpit checklist chrome for manual /continue-plan ticks
- `ghost-runner` - Stealth CLI chrome for headless agent-kit run-plan ticks
- `night-shift` - Late-shift chat chrome for continuous /run-plan loops

---

## Audit and review tooling

- Plan monitor system - External review orchestration with autonomous/paste modes
- Field Report system - Structured findings tracking with cadence management
- Plan-review-triage - Post-audit resolution workflow with residuals handling
- Memory-loop integration - Learning persistence across chat sessions
- Git workflow spine - Staging-to-production promotion with audit gates

---

## Git hooks (git-hooks/ - 3)

- `pre-commit` - Block direct commits to main/master branches
- `pre-push` - Block direct pushes to main/master and protect v* tags
- `prepare-commit-msg` - Remove Co-authored-by trailer from Cursor

---

## Root scripts (scripts/ - 11)

- `build-registry.mjs` - Build registry/registry.json from skills and packs
- `build-registry.sh` - Legacy shell version of registry builder
- `new-skill.sh` - Skill generator with SKILL.md template
- `plan-external-review.sh` - Thin forwarder to the implementation in `.cursor/scripts/`
- `plan-loop.sh` - Thin wrapper around agent-kit run-plan CLI
- `run-plan-all-consolidate.sh` - Thin forwarder to the implementation in `.cursor/scripts/`
- `sync-cli-dashboard.mjs` - Sync dashboard SoT into CLI package
- `sync-public.mjs` - Sync private repo to public mirror
- `trigger-public-sync-after-prod.sh` - GitHub Actions workflow trigger
- `verify-cli-dashboard-pack.mjs` - Verify CLI pack includes dashboard files
- Config files: `public-sync.manifest`, `public-sync.denylist`

---

## Agent Kit scripts (.cursor/scripts/ - 3)

Canonical implementations. The same-named files under `scripts/` are thin forwarders, not copies.

- `field-report-cadence-bump.sh` - Field Report activity ledger and cadence warnings
- `plan-external-review.sh` - External plan review launcher (autonomous, paste, and wait-monitor modes)
- `run-plan-all-consolidate.sh` - Multi-plan queue consolidation

---

## Templates (.cursor/context/templates/ - 9)

- `adr.md` - Architectural decision record template
- `checklist-n8n.md` - n8n workflow checklist template
- `command-worker-prompt.md` - Worker subagent instruction template
- `context-pack.md` - Working memory and session state template
- `handoff.md` - Context handoff between agents template
- `plan-external-review-prompt.md` - External review prompt template
- `plan-monitor.md` - Plan monitoring and audit template
- `plan.md` - Structured plan creation template
- `task-brief.md` - Task specification and brief template

---

## Recent capability delta (since 4.4.0)

Capabilities shipped since the 4.4.0 anchor (2026-07-21) through [Unreleased], organized by theme. The anchor represents the last deliberate identity entry before the inventory enumeration began.

### Mission Control
Interactive dashboard introduced in 4.7.0, expanded through 4.8.4. Browser-based cockpit with live plan monitoring, git status, process tracking, and terminal inspection. Includes Field Report (later Flight Log) for review triage, Checklist for plan lifecycle management, and Crew Monitor for activity feeds. Flight Log UI iteration across 4.8.0-4.8.4 with Live/Earlier gaps display and typed notification chrome.

### Multi-plan queue orchestration
Queue execution system introduced in 4.8.0. `/run-plan-all` orchestrates multiple plans with dispatched Task workers, queue confirmation asks, role-priority sorting, and mission control integration. Checklist displays queue roles (NEXT UP, QUEUED, executing). Mission control reflects queue state in current mission and plan cards.

### Autonomous external review
External plan review system matured across 4.8.0-4.8.1. Autonomous audit launch via Terminal.app with `--wait-monitor` freshness gates, post-spawn triage continuation, and config-driven preflight blocking. Mid-batch arms for `/run-plan-all` queues, batch uniform triage asks, and findings-only remediation contracts.

### Backlog CRUD
Plan backlog management commands introduced in 4.8.0. `/backlog-add`, `/backlog-edit`, `/backlog-delete`, `/backlog-cancel` for plan lifecycle without activation. HANDOFF backlog fields parsing, Mission Control backlog status display, and `/start-project` disposition gates for active plan conflicts.

### Agent personas
Character pack system introduced in 4.4.0, evolved through 4.8.0. Built-in personas (autopilot, night-shift, ghost-runner) with mode-aware chat chrome, CLI tick banners, and workspace skin configuration. Mission Control config UI for persona selection. Legacy workspace skins terminology migrated to agent personas.

### Quota hard-stop contract
API usage limit enforcement system introduced across 4.8.0-4.8.1. Hard-stop detection with HANDOFF mode tokens, `/continue-plan` pre-flight refusal, cooldown recommendations for continuous runs, and operator recovery guidance. Context guardian quota-blocked session handling with model switch recommendations.

### Hotfix command
Narrow urgent work command introduced in 4.8.0. `/hotfix` creates mini-plans (≤4 to-dos) with immediate `/run-plan` execution for time-sensitive fixes. Confirm-and-run workflow distinct from regular plan creation.

### Consumer autoupdate check
Update notification system introduced in 4.8.0. `agent-kit update --check` with config preferences for check intervals and auto-apply settings. SessionStart advisory notifications and Mission Control config toggles. Registry-based version comparison with protected paths respect.

### Path C packaging
CLI dashboard packaging: Mission Control `dashboard/**` ships inside `@dadado/agent-kit-cli` from **4.8.2** onward (verified in artifact ledger for 4.8.2–4.8.4). Multi-workspace isolation with stable ports, bundled asset discovery, and kit-host fallbacks for older pins.

### Repository readiness
Comprehensive onboarding system introduced in 4.5.0. `/agent-kit-onboard` namespaced journey with essential/non-essential pillar checks, evidence-based personalization, and merge-safe profile management. CLI doctor integration with hooks health and installation diagnostics.

### Consumer overlay protection
Hash-based content preservation system introduced in [Unreleased]. Managed-content ledger (`.cursor/agent-kit.managed-hashes.json`) preserves customized agents/skills/commands during updates while refreshing unedited kit files. L0 overlay golden rule scoped to agent trees.

---

## Total verified counts

| Surface | Estimated | Actual | Notes |
|---------|-----------|--------|-------|
| Slash commands | 25 | 26 | +1 from `/dogfood` |
| Rules | 25 | 25 | Matches estimate |
| Named agents | 13 | 13 | Matches estimate |
| Skills | 9 | 9 | Matches estimate |
| Cursor-native hooks | - | 5 | Not estimated |
| Git hooks | - | 3 | Not estimated |
| CLI commands | 13 | 18 | Higher than estimate |
| CLI subsystems | 5 | 5 | Matches estimate |
| Registry packs | - | 7 | Not estimated |
| Personas | - | 3 | Not estimated |
| Mission Control sections | - | 12 | Not estimated |
| Root scripts | - | 10 | Plus 2 sync config files |
| Agent Kit scripts | - | 3 | Not estimated |
| Templates | - | 9 | Not estimated |

---

## Positioning surfaces (identity text and publication routes)

Enumerated identity literals and publication routes from `scripts/public-sync.manifest`. This table is a working inventory, not a completeness proof. Do not treat row count as an authority for product positioning; re-validate literals against the files and the published npm/public lanes (`docs/evidence/guidance-claim-matrix.md`).

| Path | Line | Current literal text | Publication route |
|------|------|---------------------|------------------|
| `README.md` | 5 | Turn your AI coding agent into one that runs the whole workflow: plan it, build it, ship it, and remember it across long projects. | allowlist-synced (line 20) |
| `README.md` | 7 | Long AI coding sessions fall apart when the context window fills up. Agent Kit fixes this with a small operating layer that handles planning, handoff between chats, and structured git flow. The agent builds against a checkable plan and writes down where it stopped so any fresh chat picks up exactly where the last one left off. | allowlist-synced (line 20) |
| `README.md` | 11 | No more lost context. The agent keeps a short state file; new chat, one command, and it's caught up. | allowlist-synced (line 20) |
| `README.md` | 12 | Work against real plans. To-dos you can watch tick off, not vibes. Confirmations stay human-in-the-loop (Ask questions), not unchecked autonomy. | allowlist-synced (line 20) |
| `README.md` | 13 | Built-in DevOps discipline. Staging-first git flow prevents history chaos. | allowlist-synced (line 20) |
| `README.md` | 14 | Production needs confirmation. Agent can push to staging alone; promoting to `main` always asks first. | allowlist-synced (line 20) |
| `README.md` | 15 | Operational learning, not model training. Memory and optional external review keep findings durable across chats; they do not retrain the model. | allowlist-synced (line 20) |
| `README.md` | 16 | Clean history everywhere. Commits and docs describe the software, not chat chatter. | allowlist-synced (line 20) |
| `README.md` | 22 | Plans + HITL gates, `/start-project` Broad Intake, then two gates (write plan, then first unit). Confirmations use Ask questions (clickable options; chat fallback when the tool is unavailable). | allowlist-synced (line 20) |
| `README.md` | 23 | Phase handoff, `.cursor/HANDOFF.md` plus Context Guardian and native hooks (`sessionStart` / `preCompact`) so a fresh chat resumes without re-briefing. Local workspace state; not a hosted sync plane. | allowlist-synced (line 20) |
| `README.md` | 24 | Manual or continuous run, `/continue-plan` (one phase per chat) or `/run-plan` … `/run-plan-all` queues multiple plans sequentially. Plan/queue orchestration, not a general graph runtime. | allowlist-synced (line 20) |
| `README.md` | 25 | Staging → prod git, `/git-staging` for automatic promote to `origin/staging`; `/git-prod` only after explicit confirmation. Direct commits to `main` are blocked. | allowlist-synced (line 20) |
| `README.md` | 26 | Memory loop, Resolved errors and tradeoff decisions in `.cursor/memory/` so the next chat can reuse them. | allowlist-synced (line 20) |
| `README.md` | 27 | Repository readiness, Install scans the repo, applies safe local fixes, and writes a readiness snapshot. `/agent-kit-onboard` resolves remaining decisions one at a time before `/start-project`. | allowlist-synced (line 20) |
| `README.md` | 28 | Agent Personas, Mode-aware chat/CLI chrome only: Autopilot (`/continue-plan`), Night Shift (`/run-plan`), Ghost Runner (CLI). Configure after readiness or set `agentPersona` in `.cursor/context/config.json`. Never changes commits, HANDOFF, memory, or product docs. | allowlist-synced (line 20) |
| `README.md` | 29 | Optional external plan review, After a plan is exhausted, arm Claude Code for a gap monitor; triage with `/plan-review-triage`. Opt-in via config. Findings-only by default (no silent product auto-fix). | allowlist-synced (line 20) |
| `README.md` | 30 | Skills + domain packs, Registry skills and optional L1 packs (clean code, context tools, and more). Install/update via CLI; contribute upstream with `agent-kit contribute`. | allowlist-synced (line 20) |
| `README.md` | 31 | Output hygiene, Chat can be light; commits, docs, HANDOFF, and memory stay professional and inheritable. | allowlist-synced (line 20) |
| `README.md` | 33 | Production-agent layers (L0) five-layer table + link to `docs/evidence/five-layer-claim-matrix.md` | allowlist-synced (line 20) |
| `README.md` | 93 | Mission Control is a local panel over the Agent Kit runtime state. … It is a cockpit for one workspace, not a hosted multi-tenant control plane. Actions stay copy-only (clipboard + paste destination). | allowlist-synced (line 20) |
| `README.md` | 104 | The Cockpit reads as one page in four sections, each reachable from the primary navigation | allowlist-synced (line 20) |
| `README.md` | 108 | The plan in flight: status, progress, friendly Mode labels, and previous/current/next todo | allowlist-synced (line 20) |
| `README.md` | 109 | HANDOFF Gaps log (**NOW** / **Earlier**, wipe on new flight; cap 15 within a flight) plus operator Warnings (Quota pause, Heads up); palette-by-type notification chrome (`ok` / `advice` / `prompt` / `residual` / `warning`); clipboard icon; clickable copy text/path; **All clear** when idle | allowlist-synced (line 20) |
| `README.md` | 110 | What remains: recent plan cards, parked and incomplete plans, and readiness notes | allowlist-synced (line 20) |
| `README.md` | 111 | Live agent/crew feed: ticks, handoffs, deliveries, and denser `agent_step` rows for active-plan to-dos (cap 20) | allowlist-synced (line 20) |
| `README.md` | 119 | Docs | allowlist-synced (line 20) |
| `README.md` | 123 | Install, commands, day-to-day workflow | allowlist-synced (line 20) |
| `README.md` | 124 | Install discovery, `/agent-kit-onboard`, and deliverable boundary | allowlist-synced (line 20) |
| `README.md` | 125 | Exactly what lands in your project, and why there's no nested folder | allowlist-synced (line 20) |
| `README.md` | 126 | How the base install, optional packs, and your local files layer together | allowlist-synced (line 20) |
| `README.md` | 127 | Optional bundles: clean code, DevOps, testing, and more | allowlist-synced (line 20) |
| `README.md` | 128 | Mode defaults, `agentPersona` config, hygiene boundary ([create / contribute](docs/creating-personas.md)) | allowlist-synced (line 20) |
| `README.md` | 129 | Opt-in Claude Code monitor after `/run-plan` exhaustion | allowlist-synced (line 20) |
| `README.md` | 130 | The `.cursor/agent-kit.json` file | allowlist-synced (line 20) |
| `README.md` | 131 | Working on the kit itself (includes contributor quickstart) | allowlist-synced (line 20) |
| `README.md` | 132 | Everything else | allowlist-synced (line 20) |
| `README.md` | 134 | For maintainers | allowlist-synced (line 20) |
| `README.md` | 136 | Two GitHub repos, one product | allowlist-synced (line 20) |
| `README.md` | 140 | Factory: CLI, sync tooling, dogfood. Daily flow: `git staging` → `git prod` → allowlist sync. | allowlist-synced (line 20) |
| `README.md` | 141 | Storefront and **canonical registry** (`registry/**`). Consumers install from here; registry PRs land here. | allowlist-synced (line 20) |
| `README.md` | 143 | Projects that install Agent Kit receive only `.cursor/` + `autogit/` + the manifest, never the whole monorepo. | allowlist-synced (line 20) |
| `README.md` | 145 | **Three layers:** local scratch (HANDOFF/plans, gitignored) · private Git (factory) · public (storefront + registry SoT). Full cheat sheet: [docs/repository-boundaries.md](docs/repository-boundaries.md#cheat-sheet-three-layers). | allowlist-synced (line 20) |
| `package.json` | 4 | HITL framework for AI-assisted IDEs: plan, handoff, staging-to-prod, memory loop; project-aware setup for Cursor, VS Code, and Windsurf. | allowlist-synced (line 23) |
| `packages/cli/package.json` | 4 | Agent Kit CLI: HITL framework install and tooling for AI-assisted IDEs (rules, skills, plan/handoff, context). | allowlist-synced (packages/** line 39) |
| `packages/cli/README.md` | 3 | Agent Kit CLI: HITL operating-layer install and tooling for AI-assisted IDEs (rules, skills, plan/handoff, staging-to-prod, memory). It installs local workspace contracts; it is not a hosted control plane or graph workflow runtime. | allowlist-synced (packages/** line 39); npm pack storefront (`prepublishOnly` → `scripts/verify-cli-dashboard-pack.mjs`) |
| `packages/cli/src/index.ts` | 24 | HITL framework for AI-assisted IDEs | allowlist-synced (packages/** line 39) |
| `.cursor-plugin/plugin.json` | 5 | HITL framework for AI-assisted IDEs — plan, handoff, staging→prod, memory loop, anti-slop. Stack skills via agent-kit add. | allowlist-synced (.cursor-plugin/** line 69) |
| `.cursor-plugin/plugin.json` | 7-13 | ["agents","hitl","handoff","git-staging","context","multi-ide","anti-slop"] | allowlist-synced (.cursor-plugin/** line 69) |
| `docs/README.md` | 3 | Agent Kit is a HITL framework for AI-assisted IDEs: plan, handoff, staging-to-prod git flow, and memory across long projects. Install generates Cursor-first project setup; VS Code and Windsurf get partial generators (parity Low / Minimal per [cursor-native-audit.md](cursor-native-audit.md)). Mechanizable invariants live in the CLI so non-Cursor paths can run the same checks. | allowlist-synced (docs/** line 54) |
| `docs/getting-started.md` | 3 | Agent Kit keeps your AI coding agent working against a plan and stops you from losing context when a chat gets too long. This guide covers installing it, the commands you get, and how a normal day looks. | allowlist-synced (docs/** line 54) |
| `docs/CONTRIBUTING.md` | 3 | Agent Kit is a HITL framework for AI-assisted IDEs. Contributions welcome - from skills to CLI features to docs. | allowlist-synced (docs/** line 54) |
| `docs/github-about.md` | 8 | Human-in-the-loop harness for AI-assisted IDEs - plans, context handoff, memory loop, and staging→prod git workflow with explicit confirmation before production. | allowlist-synced (docs/** line 54) |
| `docs/github-about.md` | 14 | HITL framework for AI-assisted IDEs: plan → handoff → staging → prod, with a skill registry and opt-in stack packs. | allowlist-synced (docs/** line 54) |
| `docs/github-about.md` | 20 | Harness human-in-the-loop para IDEs com IA: planos, handoff de contexto, memory loop e fluxo git staging→prod com confirmação explícita antes de produção. | allowlist-synced (docs/** line 54) |
| `docs/github-about.md` | 25 | `ai-assisted-development` `cursor` `vscode` `windsurf` `developer-tools` `cli` `monorepo` `agent-kit` `prompt-engineering` `skills` `templates` `handoff` `context-management` `human-in-the-loop` | allowlist-synced (docs/** line 54) |
| `docs/cursor-native-audit.md` | 30 | HITL framework for AI-assisted IDEs (plan, handoff, staging→prod, memory loop) | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 12 | Para resolver esse e outros problemas, como a falta de um fluxo de DevOps estruturado, conexão segura com ferramentas e versionamento, ao longo de um ano, fui desenvolvendo o *Agent Kit*! | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 17 | É uma camada operacional leve que transforma seu IDE (Cursor, VS Code, etc.) em um framework que gerencia o planejamento, o handoff entre chats e o fluxo de Git / DevOps estruturado para você focar no que importa. | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 10 | Se você usa o Cursor ou outro IDE com IA assistida para codar, já deve ter passado pelo clássico problema de ver a IA se perder e alucinar quando o chat fica muito longo e o contexto enche. | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 16 | O que é o Agent Kit? | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 19 | O que ele resolve? | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 20 | Onboarding & Setup Inteligente: Ele analisa o seu projeto, descobre o que está faltando e gera regras, comandos e skills personalizados sob medida para a sua stack e padrões de código. | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 21 | Sem perda de contexto: Ele mantém o estado do seu projeto vivo. Abriu um chat novo? Um comando e a IA já sabe exatamente onde parou. | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 22 | Planos de verdade: "vibecoding" mas nem tanto. A IA trabalha em cima de to-dos reais que você acompanha passo a passo no loop. | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 23 | DevOps integrado: Fluxo de Git seguro com staging automático e commits limpos. | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 24 | Segurança em produção: A IA pode subir para staging sozinha, mas promover para `main` sempre exige sua confirmação direta. Hooks nativos protegem a IA de fazer isso alucinando. | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 26 | Como usar? | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 30 | `npx @dadado/agent-kit-cli install` | allowlist-synced (docs/** line 54) |
| `docs/public-launch-announcement.md` | 35 | Depois de instalado, você ganha comandos como `/agent-kit-onboard`, `/start-project` e `/continue-plan` diretamente no chat do seu editor. | allowlist-synced (docs/** line 54) |
| `install.md` | 1 | Agent Kit - Installation | allowlist-synced (line 32) |
| `install.md` | 3 | You are the installer. Set up the kit **in the user's project** without copying the entire Agent Kit monorepo into it. | allowlist-synced (line 32) |
| `registry/registry.json` | 8-342 | 34 skill/pack descriptions across line range (e.g., "Remove AI code slop", "HITL framework install and tooling", "Create and update ClickUp tasks via MCP") | public-repo-PR-only (excluded line 89) |
| `registry/packs/clean-code/pack.json` | 5 | Deslop, simplicity, and surgical refactors for AI-assisted codebases. | public-repo-PR-only (excluded line 89) |
| `registry/packs/context-management/pack.json` | 5 | Advanced context packs, librarian/extractor agents, and window-budget helpers beyond L0 guardian, memory-loop, and native phase/context hooks. | public-repo-PR-only (excluded line 89) |
| `registry/packs/cybersec/pack.json` | 5 | Security review, secrets/PII awareness, and pre-merge hardening. Includes git-secrets-safety as a pack double-check (also L0 always-on). | public-repo-PR-only (excluded line 89) |
| `registry/packs/devops/pack.json` | 5 | CI/CD scaffolding templates and infra guidance beyond the structural git staging→prod spine. | public-repo-PR-only (excluded line 89) |
| `registry/packs/engineering-architecture/pack.json` | 5 | ADRs, technology tradeoffs, docs honesty, and tech-lead style decisions - stack-agnostic. | public-repo-PR-only (excluded line 89) |
| `registry/packs/project-management/pack.json` | 5 | Optional PM-tool adapters and project sizing helpers. Structural plan/handoff stays in L0. | public-repo-PR-only (excluded line 89) |
| `registry/packs/quality/pack.json` | 5 | Testing conventions, QA routines, and review checklists, not language runtimes. | public-repo-PR-only (excluded line 89) |
| `dashboard/dashboard.html` | 7 | Mission Control | allowlist-synced (dashboard/** line 43) |
| `_legacy/v2/plugin.json` | 5 | Context memory, handoff between agents, Git homolog/prod workflow, skills, rules, and hooks for Cursor. | allowlist-synced (_legacy/** line 85) |
| `_legacy/v2/skills-registry.json` | 5 | Cria e atualiza tasks no ClickUp via MCP seguindo convenções do workspace (títulos, descrições, status, prioridade, subtarefas). Use ao criar/editar tarefas, planejar sprints ou fazer breakdown de features. | allowlist-synced (_legacy/** line 85) |
| `_legacy/v2/skills-registry.json` | 6 | Valida, formata e manipula JSON (configs, payloads, workflows n8n, respostas de IA). Use ao editar .json, configs, código que parseia JSON ou quando o usuário mencionar JSON, payload, schema. | allowlist-synced (_legacy/** line 85) |
| `_legacy/v2/skills-registry.json` | 7 | Cria, edita e documenta workflows n8n (nodes, webhooks, Execute Workflow, credenciais, import/export JSON). Use ao trabalhar com n8n, workflows de automação ou quando o usuário mencionar n8n. | allowlist-synced (_legacy/** line 85) |
| `_legacy/v2/skills-registry.json` | 8 | Cria e edita prompts de agentes em Markdown (estrutura, sistema/usuário, versionamento). Use ao editar prompt-*.md, prompts/*.md ou quando o usuário mencionar prompt de agente, instruções de IA. | allowlist-synced (_legacy/** line 85) |
| `_legacy/v2/skills-registry.json` | 9 | Escreve e revisa SQL para Postgres (DDL, DML, índices, constraints). Use ao editar .sql, schemas para n8n ou quando o usuário mencionar tabelas, migrations, Postgres. | allowlist-synced (_legacy/** line 85) |
| `_legacy/v2/skills-registry.json` | 10 | Boas práticas para fluxos conversacionais em agentes de chat (mensagens curtas, tom, confirmações, handoff). Use ao criar prompts de chat, WhatsApp, Telegram ou revisar fluxos de atendimento. | allowlist-synced (_legacy/** line 85) |
| `_legacy/v2/skills-registry.json` | 11 | Remove AI-generated code slop (redundant comments, unnecessary try/catch, any casts, deep nesting). Use after AI-assisted coding sessions or before code review to clean up machine-generated patterns. | allowlist-synced (_legacy/** line 85) |
| `skills-registry.json` | 5-10 | Create and update ClickUp tasks via MCP..., Validate, format, and manipulate JSON..., Create, edit and document n8n workflows..., Create and edit agent prompts in Markdown..., Write and review SQL for Postgres..., Best practices for conversational flows... | allowlist-synced (no exclusion matches) |
