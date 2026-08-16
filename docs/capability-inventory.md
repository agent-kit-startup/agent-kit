# Capability inventory

Mission Kit capability catalog grouped by surface family. Lists every shipped capability with one line per item. Storefront positioning uses **Mission Kit** on [missionkit.io](https://missionkit.io); CLI, npm, slash commands, and `.cursor/agent-kit.json` remain Agent Kit identifiers (naming ADR `2026-08-06_mission-kit-vs-agent-kit-naming`).

**Status (2026-08-06):** Product manifests at `5.0.0`. Capability counts verified against the working tree on private `staging` @ `7fdb03c` (see Real counts). Catalog narrative remains indicative for non-count claims. Evidence lanes: `docs/evidence/artifact-ledger-summary.md`, `docs/evidence/delivery-reconciliation.json` (RC-003/RC-004). Five-layer README positioning claims: `docs/evidence/five-layer-claim-matrix.md` / `docs/five-layer-claim-matrix.md`.

Real counts (verified against the working tree on 2026-08-13): **28** slash commands under `.cursor/commands/` (**27** synced/L0-oriented; **1** factory-only `/public-issue-triage` excluded from public-sync and L0 install), 25 rules, 14 agents, 10 skills, 5 Cursor hooks, 18 CLI commands (plus 5 subsystems), 7 packs, 3 personas, Mission Control dashboard, Git hooks, root scripts, and auxiliary tooling. Prior SHA snapshot `7fdb03c` was 13 agents / 9 skills before `mission-kit-comms`.

---

## Slash commands (.cursor/commands/ - 28)

Factory-only counting policy: inventories that describe the **consumer/L0** surface should cite **27** syncable commands (excluding `/public-issue-triage`). The on-disk factory tree has **28** files; `/public-issue-triage` is omitted from L0 install and excluded from `scripts/public-sync.manifest`.

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
- `/public-issue-triage` - Factory-only maintainer triage for the public GitHub issues inbox (HITL; not L0 / not public-sync)

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

## Named subagents (.cursor/agents/ - 14)

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
- `mission-kit-comms` - Adoption/comms drafts with HITL-before-post (not an Agent Persona)

---

## Skills (.cursor/skills/ - 10)

### Core skills (2)
- `clean-code` - AI code slop removal and clean patterns
- `docs-repo` - Repository documentation with professional standard

### Community skills (8)
- `clickup` - ClickUp task management via MCP
- `cursor-skills-node` - Node.js development standards
- `json-data-config` - JSON validation, formatting, manipulation
- `mission-kit-comms` - Mission Kit recap/release/contributor drafts; HITL-before-post
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

| Path | Anchor | Current literal text | Publication route |
|------|--------|---------------------|------------------|
| `README.md` | L5 | Development operations built into Cursor and VS Code. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L7 | Mission Kit 5 is a free (personal and non-commercial) source-available framework under PolyForm Noncommercial for plan, build, review, and … | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L9 | Long AI coding sessions fall apart when the context window fills up. The kit fixes this with a small operating layer that handles planning,… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L13 | No more lost context. The agent keeps a short state file; new chat, one command, and it's caught up. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L14 | Work against real plans. To-dos you can watch tick off, not vibes. Autonomy stays optional and gated. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L15 | Built-in DevOps discipline. Staging-first git flow prevents history chaos. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L16 | Production needs confirmation. Agent can push to staging alone; promoting to `main` always asks first. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L17 | Operational learning, not model training. Memory and optional external review keep findings durable across chats; they do not retrain the … | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L18 | Clean history everywhere. Commits and docs describe the software, not chat chatter. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L24 | Plans + HITL gates — `/start-project` Broad Intake, then two gates (write plan, then first unit). Confirmations use Ask questions (clickabl… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L25 | Phase handoff — `.cursor/HANDOFF.md` plus Context Guardian and native hooks (`sessionStart` / `preCompact`) so a fresh chat resumes without… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L26 | Manual or continuous run — `/continue-plan` (one phase per chat) or `/run-plan` (runs to the end; picks worker orchestration or in-session … | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L27 | Staging → prod git — `/git-staging` for automatic promote to `origin/staging`; `/git-prod` only after explicit confirmation. Direct commits… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L28 | Memory loop — Resolved errors and tradeoff decisions in `.cursor/memory/` so the next chat can reuse them. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L29 | Repository readiness — Install scans the repo, applies safe local fixes, and writes a readiness snapshot. `/agent-kit-onboard` resolves rem… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L30 | Agent Personas — Mode-aware chat/CLI chrome only: Autopilot (`/continue-plan`), Night Shift (`/run-plan`), Ghost Runner (CLI). Configure af… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L31 | Optional external plan review — After a plan is exhausted, arm Claude Code for a gap monitor; triage with `/plan-review-triage`. Opt-in via… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L32 | Skills + domain packs — Registry skills and optional L1 packs (clean code, context tools, and more). Install/update via CLI; contribute ups… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L33 | Output hygiene — Chat can be light; commits, docs, HANDOFF, and memory stay professional and inheritable. | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L35 | ### Production-agent layers (L0) | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L95 | Mission Control is a local panel over Agent Kit runtime state. It binds to loopback by default and serves only its own static files. It is … | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L109 | Primary sections: Current mission, Flight Log, Checklist, Crew Monitor. More menu: Plans, Activity, Agents, Skills, Commands, Health, Git, Memory, Terminals, Processes, Config… | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L119 | [Repository readiness](repository-readiness-onboarding.md) — Install discovery, `/agent-kit-onboard`, and deliverable boundary | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L120 | [Bootstrap](bootstrap.md) — Exactly what lands in your project, and why there's no nested folder | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L121 | [Layers](layers-spec.md) — How the base install, optional packs, and your local files layer together | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L122 | [Domain packs](domain-packs.md) — Optional bundles: clean code, DevOps, testing, and more | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L123 | [Agent Personas](personas-contract.md) — Mode defaults, `agentPersona` config, hygiene boundary ([create / contribute](creating-personas.md)) | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L125 | [Manifest](agent-kit-manifest.md) — The `.cursor/agent-kit.json` file | allowlist-synced (`README.md` in `scripts/public-sync.manifest`) |
| `README.md` | L126 | [Contributing](CONTRIBUTING.md) — Working on the kit itself (includes contributor quickstart) | allowlist-synced (`README.md`) |
| `README.md` | L127 | [Development](DEVELOPMENT.md) — Factory topology, local CLI, and maintainer workflows | allowlist-synced (`README.md`) |
| `README.md` | L140 | Want to improve skills, docs, or the CLI? Start at docs/CONTRIBUTING.md… | allowlist-synced (`README.md`) |
| `docs/DEVELOPMENT.md` | (H1/body) | Factory topology, local CLI loops, public-sync awareness | allowlist-synced (`docs/**`) |
| `package.json` | 4 | HITL framework for AI-assisted IDEs: plan, handoff, staging-to-prod, memory loop; project-aware setup for Cursor, VS Code, and Windsurf. | allowlist-synced (manifest path pattern) |
| `packages/cli/package.json` | 4 | Agent Kit CLI: HITL framework install and tooling for AI-assisted IDEs (rules, skills, plan/handoff, context). | allowlist-synced (`packages/**` in `scripts/public-sync.manifest`) |
| `packages/cli/README.md` | 3 | Agent Kit CLI: HITL operating-layer install and tooling for AI-assisted IDEs (rules, skills, plan/handoff, staging-to-prod, memory). It installs local workspace contracts; it is not a hosted control plane or graph workflow runtime. | allowlist-synced (`packages/**` in `scripts/public-sync.manifest`); npm pack storefront (`prepublishOnly` → `scripts/verify-cli-dashboard-pack.mjs`) |
| `packages/cli/src/index.ts` | 24 | HITL framework for AI-assisted IDEs | allowlist-synced (`packages/**` in `scripts/public-sync.manifest`) |
| `.cursor-plugin/plugin.json` | 5 | HITL framework for AI-assisted IDEs — plan, handoff, staging→prod, memory loop, anti-slop. Stack skills via agent-kit add. | allowlist-synced (`.cursor-plugin/**` in `scripts/public-sync.manifest`) |
| `.cursor-plugin/plugin.json` | 7-13 | ["agents","hitl","handoff","git-staging","context","multi-ide","anti-slop"] | allowlist-synced (`.cursor-plugin/**` in `scripts/public-sync.manifest`) |
| `docs/README.md` | 3 | **Mission Kit** is the product-family name on missionkit.io. **Agent Kit** is the technical install surface … HITL framework for AI-assisted IDEs … | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/getting-started.md` | 3 | **Mission Kit** (marketing / missionkit.io) ships as **Agent Kit** on install … keeps your AI coding agent working against a plan … | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/CONTRIBUTING.md` | 3 | **Mission Kit** is the storefront name; contributions land in the **Agent Kit** repository … HITL framework for AI-assisted IDEs. | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/github-about.md` | 8 | Mission Kit 5: development operations for Cursor and VS Code. HITL plans, handoff, memory, and staging→prod git … (Installs as Agent Kit.) | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/github-about.md` | 14 | HITL development operations for AI-assisted IDEs: plan → handoff → staging → prod (Agent Kit install / CLI). | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/github-about.md` | 20 | Harness human-in-the-loop para IDEs com IA: planos, handoff de contexto, memory loop e fluxo git staging→prod com confirmação explícita antes de produção. | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/github-about.md` | 25 | `ai-assisted-development` `cursor` `vscode` `windsurf` `developer-tools` `cli` `monorepo` `agent-kit` `prompt-engineering` `skills` `templates` `handoff` `context-management` `human-in-the-loop` | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/cursor-native-audit.md` | 30 | HITL framework for AI-assisted IDEs (plan, handoff, staging→prod, memory loop) | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 12 | Para resolver isso (e a falta de DevOps estruturado no fluxo do agente), existe o *Mission Kit 5*: development operations dentro do Cursor e do VS Code. Site: https://missionkit.io | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 14 | No GitHub, npm e CLI o projeto ainda se chama *Agent Kit* (pacote `@dadado/agent-kit-cli`, comando `agent-kit`, `/agent-kit-onboard`). Mesmo produto, dois nomes de propósito. 🛠️ | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 17 | Uma camada operacional leve que transforma seu IDE em um framework HITL: planejamento, handoff entre chats, revisão externa opcional e fluxo Git staging→prod com confirmação antes de produção. Não é marketing de "autonomia sem freio". | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 10 | Se você usa o Cursor ou outro IDE com IA assistida para codar, já deve ter passado pelo clássico problema de ver a IA se perder e alucinar quando o chat fica muito longo e o contexto enche. 🤯 | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 16 | *🤔 O que é?* | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 19 | *✨ O que ele resolve?* | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 20 | • *Onboarding & Setup Inteligente:* analisa o projeto e prepara regras, comandos e skills sob medida (`/agent-kit-onboard`). 🧠✨ | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 21 | • *Sem perda de contexto:* estado vivo entre chats; um comando e a IA sabe onde parou. 🔄 | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 22 | • *Planos de verdade:* to-dos reais, com humano no loop (Ask questions). 📋 | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 23 | • *DevOps integrado:* staging automático, Conventional Commits, hooks. 🛡️ | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 24 | • *Produção com confirmação:* staging pode ir sozinho; `main` só depois de você confirmar. 🛑 | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 25 | • *Mission Control:* cockpit local (`/dashboard` / `agent-kit dashboard`) sobre o que está no disco. | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 27 | *🚀 Como usar?* | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 30 | `npx @dadado/agent-kit-cli install` | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `docs/public-launch-announcement.md` | 34 | Depois: `/agent-kit-onboard`, `/start-project`, `/continue-plan` ou `/run-plan`. | allowlist-synced (`docs/**` in `scripts/public-sync.manifest`) |
| `install.md` | 1 | Mission Kit / Agent Kit - Installation | allowlist-synced (`install.md` in `scripts/public-sync.manifest`) |
| `install.md` | 3 | You are the installer for Mission Kit 5. Marketing name: Mission Kit; technical surfaces: Agent Kit … | allowlist-synced (`install.md` in `scripts/public-sync.manifest`) |
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
| `skills-registry.json` | 5-10 | Create and update ClickUp tasks via MCP..., Validate, format, and manipulate JSON..., Create, edit and document n8n workflows..., Create and edit agent prompts in Markdown..., Write and review SQL for Postgres..., Best practices for conversational flows.. | allowlist-synced (no exclusion matches) |
