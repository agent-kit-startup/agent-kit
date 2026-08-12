# Getting Started

**Mission Kit** (marketing / [missionkit.io](https://missionkit.io)) ships as **Agent Kit** on install: CLI, npm, and slash commands. The kit keeps your AI coding agent working against a plan and stops you from losing context when a chat gets too long. This guide covers installing it, the commands you get, and how a normal day looks.

## Install

Run this from your project's root folder:

```bash
npx @dadado/agent-kit-cli install
```

**Prerequisites:** Node.js 20+ (CLI `engines`). Git is recommended so `/agent-kit-onboard` and the staging→prod flow can complete; Port B can still copy L0 files without the CLI when Node is unavailable.

Unpinned `npx` resolves to the latest publish. Pin a version when you need a reproducible install: `npx @dadado/agent-kit-cli@x.y.z install` (replace `x.y.z` with a version from npm).

**IDE-agnostic:** works in Cursor, VS Code, and any terminal with Node.js. For non-interactive terminals (CI, piped stdin, VS Code output panels without TTY), suppress both `npx`'s own confirmation and the CLI's root prompt:

```bash
npx -y @dadado/agent-kit-cli install --yes
```

- `npx -y` answers `npx`'s "Ok to proceed?" prompt when the package is not cached.
- `--yes` (or `AGENT_KIT_YES=1`) skips the CLI's project-root confirmation prompt.

**Troubleshooting npm failures:**

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `EPERM` / `EACCES` on npm cache | User-level cache ownership drift | `npx --cache .npm-cache @dadado/agent-kit-cli install` or `npm cache clean --force` |
| Exit 255 (no output) | `npx` prompted for confirmation in a non-TTY environment | Use `npx -y @dadado/agent-kit-cli install` for the `npx` prompt; add `--yes` or set `AGENT_KIT_YES=1` for the CLI root prompt |
| `403 Forbidden` from registry | Auth policy or private scope | `npm login`, check `.npmrc`, or use Port B fallback |

That's the whole install for kit L0. It drops a small set of rules and slash commands into `.cursor/`, a git routine into `autogit/`, and a manifest (`.cursor/agent-kit.json`) that records what was installed so the kit can update itself later without touching your work. Mission Control's `dashboard/` server is **not** copied into your project; the panel runs from the CLI package (4.8.2 onward) or from an agent-kit checkout. See [Mission Control production-ship constraints](#mission-control-production-ship-constraints).

**Multi-workspace safety:** the CLI confirms the absolute project root before writing any files (interactive prompt; `--yes` skips the prompt). Each project gets its own `.cursor/` tree and overlay ledger. The shared registry cache (`~/.cache/agent-kit/registry/`) uses a directory lock so parallel installs on the same machine cannot corrupt it.

Want a few extra bundles up front? Add packs (clean code, context tools, and more - see [domain packs](domain-packs.md)):

```bash
npx @dadado/agent-kit-cli install --pack clean-code,context-management
```

**Prefer chat install?** Copy-paste the installer brief from the [README](../README.md#install) into Cursor chat. You get exactly the same result. The chat installer uses **Ask questions** for confirmations (clickable options in IDE UI, with chat fallback when tool unavailable), while the CLI uses terminal prompts.

> Don't clone the Agent Kit repo into your project. Installing writes only the files your project needs - see [bootstrap](bootstrap.md) for the exact layout.

`install` also scans the repository, applies safe local preparation, and writes `.cursor/context/readiness.json`. Guided entry still works through `init`, which reuses the same install and readiness path:

```bash
npx @dadado/agent-kit-cli init
```

Diagnose without installing:

```bash
npx @dadado/agent-kit-cli doctor --json
npx @dadado/agent-kit-cli doctor --fix-safe
```

### After install checklist (personal path)

Keep this path light. No extra runtime packages beyond the CLI (`@clack/prompts`, `citty`, `kolorist` only).

1. **Node.js 20+** - required for `npx` / `agent-kit` CLI (`engines` in package manifests).
2. **Git** - recommended so readiness pillars and `/git-staging` → `/git-prod` work; local-only Git is valid.
3. **Install** - `npx @dadado/agent-kit-cli install` (or Port B via `install.md`).
4. **Onboard** - `/agent-kit-onboard` until every essential readiness check is ready (non-essentials may defer with a recovery action).
5. **Kit commands** - e.g. `/start-project` in the consumer project.
6. **Mission Control panel (optional)** - `/dashboard`, `npm run dashboard`, or `agent-kit dashboard`. Consumer L0 does not copy `dashboard/` into the project. `agent-kit dashboard` resolves `dashboard/start.mjs` from the installed package (4.8.2 onward); on older pins use a kit checkout or env/sibling discovery. Loopback only (`127.0.0.1`) by default. Opt-in LAN: `agent-kit dashboard-broadcast` / `npm run dashboard:broadcast` (token-gated) prints a Mission Kit **Share** URL (`https://missionkit.io/mc/open.html#…`, BYO HTTPS via `MISSION_CONTROL_SHARE_BASE`; set `off` for LAN-only). The Share URL embeds the live token (same secret handling); soft TTL is advisory (`MISSION_CONTROL_SHARE_TTL_SEC`, `0` = never). Still requires trusted-LAN reachability; not a WAN relay. The slash `/dashboard-broadcast` ships in the **factory** checkout and CLI docs only (not an L0 consumer artifact); consumers use the CLI/npm entrypoints above. CLI/OS opens use one preferred browser (`missionControl.preferredBrowser`, `MISSION_CONTROL_PREFERRED_BROWSER`, or `--browser`; platform-specific **name**, not a path) or the OS default; slash `/dashboard` opens via IDE browser MCP only (not multi-browser). Posture: [Mission Control production-ship constraints](#mission-control-production-ship-constraints).

## The commands you get

| Command | What it does |
|---------|-------------|
| `agent-kit install [profile]` | Install the base kit, run readiness, apply safe local fixes |
| `agent-kit init` | Compatibility entry that runs the same install and readiness workflow |
| `agent-kit doctor` | Print or repair repository readiness (`--json`, `--fix-safe`) |
| `agent-kit add <id>` | Add one skill or pack later |
| `agent-kit status` | Show install state, readiness summary, and profile origin |
| `agent-kit update --check` | Notify-only version compare vs public tags (no L0 writes) |
| `agent-kit cursor-awareness --check` | Opt-in advisory: Cursor changelog vs native-audit inventory (no apply) |
| `agent-kit update` | Explicit apply: pull latest rules/commands; leaves your own files alone |
| `agent-kit diff` | Show what changed between what you have and the latest |
| `agent-kit contribute` | Send an improvement you made locally back upstream |
| `agent-kit handoff` | Save your progress to `.cursor/HANDOFF.md` |
| `agent-kit scan` | Just scan the project, don't install |

## A normal day

The idea is simple: work against a plan, save your place before a conversation gets too big, and (in **manual** mode) keep **one phase per chat**. Continuous and queue modes are opt-in denser paths under [Less babysitting](#less-babysitting). Modes overview: [plan-routine §5](../autogit/plan-routine.md#5-two-execution-modes).

### Manual playbook (default)

Operator sequence when you drive each unit (command SoT: [`.cursor/commands/continue-plan.md`](../.cursor/commands/continue-plan.md); Gate A/B SoT: [`.cursor/commands/start-project.md`](../.cursor/commands/start-project.md)):

0. **`/agent-kit-onboard`** *(first time / incomplete readiness)* - Repository preparation only: show detected facts, safe fixes, and one pending decision at a time via **Ask questions**. Completes when essential readiness checks pass (or allowed non-essential items are deferred with a recovery action). Skins and external review stay optional after essentials. Path after CLI install: open the folder in Cursor → `/agent-kit-onboard` → `/start-project`. Contract: [repository-readiness-onboarding.md](repository-readiness-onboarding.md).
1. **`/start-project`** - After the repository is prepared, Broad Intake Review (buckets listed in the command, including **Unprocessed dogfood** from `dogfood/README.md` or `.cursor/dogfood/README.md` under `##` or `### Unprocessed Files`) and two gates using **Ask questions**: (A) the agent proposes and writes a plan with checkable to-dos (no coding yet); (B) only after you confirm, it runs the **first** unit. Broad Intake's Memory bucket consults `.cursor/memory/plan-monitor-*.md` and theme-matched `plan-review-*` audits (duplicates / open residuals / outdated reviews) without changing Field Report detection. Unprocessed dogfood uses the same triage labels and never auto-analyzes (ADR `2026-08-11_dogfood-unprocessed-broad-intake-bucket.md`). Uses clickable options with chat fallback when tool unavailable. Goal text in the same message is not execute permission.
1b. **Backlog without activation** - `/backlog-add` runs the same Broad Intake (including plan-monitor consult and Unprocessed dogfood), writes a plan, and appends it under HANDOFF Backlog plans (no Gate B, never parks or activates the new plan). Manage rows with `/backlog-edit`, `/backlog-delete` (move to `.cursor/plans/archive/`), and `/backlog-cancel` (soft-cancel open to-dos, keep the file). All mutates use **Ask questions** (chat numbered-list fallback). Distinct from `/archive-plan` (parked list only). Routine backlog CRUD does not create Field Report cards.
2. **Confirm the unit, then work one phase.** On `/continue-plan` (and after Gate B on a new plan), the agent uses **Ask questions** before editing (`Start [to-do-id]` / `Edit plan first` / `Switch to different plan` / `Stop here`). Before that Ask it also runs advisory Unprocessed dogfood preflight (mention non-empty inbox; never block solely for inbox). After you pick Start, it implements **only** that phase (or one heavy to-do), checks it off, updates `.cursor/HANDOFF.md`, and **stops**. Context Guardian plus **native Cursor hooks** (`sessionStart` / `preCompact`) enforce that boundary; multi-phase in one window needs `/run-plan` or `/run-plan-all` below. `/run-plan` and `/run-plan-all` apply the same advisory dogfood preflight on first tick / queue confirm.
3. **Suggest staging when there is a diff.** After the unit, the agent should suggest `/git-staging` (you run it when ready). Do not expect automatic promote to production; `/git-prod` is always a separate HITL step.
4. **Handoff if the window fills.** `/handoff` (or guardian auto-handoff when configured) writes where things stand before context is lost.
5. **New chat → paste `/continue-plan`.** Open a **fresh** conversation for the next phase. The agent reads HANDOFF, confirms the next unit again, and continues without you re-explaining the project. Chat tone follows the Autopilot persona by default (see [personas contract](personas-contract.md)). Mission Control Checklist Actions can copy `/continue-plan <plan>`; Current mission shows operator-friendly Mode labels (auto mode / run all / human-in-the-loop; HANDOFF keeps raw Mode tokens) and offers copy-only `/git-staging` (and mode-aware `/continue-plan` when Mode is manual).

### Which command next?

| You want… | Paste / run |
|-----------|-------------|
| Prepare the repo (first time or blocked essentials) | `/agent-kit-onboard` |
| Create a plan; run the first unit only after confirm | `/start-project` |
| Enqueue a plan without activating it | `/backlog-add` |
| Resume the next phase yourself (default) | New chat → `/continue-plan` |
| Run one plan to the end (auto staging per tick) | `/run-plan` |
| Narrow urgent fix as a mini plan, then run ticks | `/hotfix` |
| Run several plans as one ordered queue | `/run-plan-all` |
| Commit / MR to `staging` after a manual unit | `/git-staging` |
| Promote `staging` → `main` | `/git-prod` (explicit confirm only) |

Do not re-author Gate A/B or continuous tick contracts here; link L0 commands when you need the full contract.

### Keeping Agent Kit current (consumers)

- **Opt-in check:** set `updateCheck.enabled: true` in `.cursor/context/config.json` (Mission Control Config can toggle it). SessionStart may then nudge when a newer public release exists; interval is `updateCheck.intervalDays` (default 7).
- **Manual check:** `agent-kit update --check --json`.
- **Apply:** run `/update` and confirm with Ask questions (or an explicit terminal `agent-kit update`). Never silent L0 overwrite; `updateApply.auto` defaults to `false`.
- Not the same as public sync (factory publish) or remote-cache refresh on resolve.

### Agent Personas

Personas change **chat tone and CLI tick banners only**. Defaults by mode: Autopilot for `/continue-plan`, Night Shift for `/run-plan`, Ghost Runner for `agent-kit run-plan`. They never alter commits, HANDOFF, memory, or product documentation. Configure them after readiness (personalization step, Mission Control **Config** under More, or edit `agentPersona` in `.cursor/context/config.json`). Contract and contribute path: [personas-contract.md](personas-contract.md), [creating-personas.md](creating-personas.md).

For the full list of consumer-configurable knobs (session config, dashboard skin, install-time choices, CLI flags) with copy-paste snippets for each, see [consumer-configuration.md](consumer-configuration.md).

### Less babysitting

- **`/run-plan`** - the agent works through the plan to the end, checking off to-dos and pushing to staging when there's something to commit (Night Shift chat chrome by default). It picks the best execution strategy itself: worker delegation when your setup supports it (keeps the main chat from filling up), a same-chat loop otherwise. It never promotes to production on its own. The old `/run-plan-loop` and `/run-plan-orchestrated` still work as deprecated aliases.

- **`/hotfix`** - for a **narrow urgent** change (icons, copy, one CSS token): confirm → write a mini plan → run the same `/run-plan` tick contract continuously. Prefer `/start-project` when scope is ambiguous or multi-domain. Full spec: [`.cursor/commands/hotfix.md`](../.cursor/commands/hotfix.md).
  - **Model / quota tip:** prefer a named model (Claude Opus, Sonnet 4.6, Composer 2.5 Fast) over Auto for long continuous runs. Auto and named models may use separate quota buckets; Auto can fall back after a limit and lose Ask questions. If you stay on Auto, set `interTickCooldownMs` to **15000** in Mission Control **Config** or `.cursor/context/config.json` (default stays `0` so named-model runs are not slowed). After an API-limit hard stop, do not expect the next tick to auto-resume until you confirm recovery. Do not throttle Mission Control refresh to "save" Agent quota (dashboard is local-only). When authoring plans, **split** docs-only close-out to-dos from product `read_scope` ticks so more Auto ticks qualify for inline-first ([plan-routine §6](../autogit/plan-routine.md#6-context-budget-per-to-do-optional)).

  > **Note for headless/scheduled execution:** If running continuous plan loops or scheduled agents outside the IDE (e.g. via `agent-kit run-plan` or `scripts/plan-loop.sh`), use a separate git worktree or clone rather than sharing an interactive working tree. This prevents conflicts between automated commits and manual work.

- **`/run-plan-all`** - run **multiple plans** as one ordered, deduplicated queue. Use it when Gate-A backlog plans have piled up, scopes overlap, or you want batch throughput instead of activating `/run-plan` plan by plan. Full command spec: [`.cursor/commands/run-plan-all.md`](../.cursor/commands/run-plan-all.md). Operator detail below; modes overview also in [plan-routine.md](../autogit/plan-routine.md) and the root [README](../README.md).

  1. **PO synthesis** - a read-only Task(`explore`) scans recent merges, commits, CHANGELOG, HANDOFF, and every eligible plan, then returns a proposed execution order with overlap and consolidation notes. The main window reviews that report only.
  2. **Confirm queue** - mandatory **Ask questions** gate with six options:

     | Option | What it does |
     |--------|--------------|
     | `Run as proposed` | Apply approved merges/drops, write queue to HANDOFF, start execution |
     | `Edit order` | Apply consolidations, then run your custom order |
     | `Apply merges & drops only` | Apply consolidations; keep heuristic order for the rest |
     | `Keep all plans as-is` | No plan-file mutations; run the proposed order |
     | `Include Gate-B plans` | Re-run synthesis with Gate-B-awaiting plans included (when any exist) |
     | `Cancel` | Abort; HANDOFF unchanged |

  3. **Execute** - after you confirm, the main window is a **pure orchestrator**: it dispatches **one Task subagent per plan** (each runs the `/run-plan` tick contract). It never implements to-dos in-window. Plans run **sequentially**, not in parallel. Never `/git-prod` from this command. The queue is **non-stop** mid-run: no external-review Ask/paste between plans. Optional external review arms **once at queue end**; see [external plan review](external-plan-review.md#run-plan-all).

  **Resume mid-queue:** if context fills up or you start a fresh chat, paste `/run-plan-all` again. The agent reads HANDOFF (`Mode: run-plan-all`, `Run queue`, `Queue cursor`, `Queue outcomes`) and dispatches the next plan as a Task without re-synthesizing. If a queued plan was deleted or materially changed outside the queue, run a new synthesis.

  **Named model tip:** for long queues, prefer a **named model** (Claude Opus, Sonnet 4.6, Composer 2.5 Fast) over Auto. Named models have separate quota buckets and keep Ask questions available for HITL.

  **Mission Control shortcut:** the Checklist **Run all** header button copies `/run-plan-all` into chat input (copy-only; it does not write HANDOFF or start the queue). While a queue is live, Checklist cards sort by role-priority (executing, then next up, then queued / completed), not by Run queue index. Plan card Actions also offer **Run (manual)** (`/continue-plan`) and **Run (auto)** (`/run-plan`) as copy-only pastes.

### Optional external plan review

When `/run-plan` finishes all implementable to-dos, you can get a second-agent check of the shipped work. Artifacts ship with L0; the feature stays opt-in (`enabled: false` by default).

1. **Enable it:** set `"externalPlanReview": { "enabled": true, "offerOnExhausted": true }` in `.cursor/context/config.json` (see `config.example.json`), or accept the exhaustion Ask when a single `/run-plan` finishes (or once when a `/run-plan-all` queue exhausts)
2. **Chat path:** when enabled or you pick `Run review now`, the agent prepares a paste command (`--paste-only` / `--force --paste-only`); you run it in **your** Cursor Terminal (not a silent agent-shell `claude -p`)
3. **Headless / CI:** `agent-kit run-plan` may arm the launcher with `--force` (`claude -p`) in the runner shell
4. **Exhaustion Ask:** if not enabled and `offerOnExhausted` is not `false`, chat must Ask `Run review now` / `Always enable automatic` / `Not now`. `Not now` is per-session only (no persist)
5. **Manual:** `/plan-external-review` anytime after a plan is done
6. **Triage:** after Claude writes a monitor file, use `/plan-review-triage` with explicit path(s). Prefer **Ack and stop** or **Fix nits only** when residuals are nits/process-only or closeout depth is already capped; **Write residuals plan** runs Broad Intake (including Unprocessed dogfood) then backlog write-confirm and must not spawn unbounded `close-*` chains (ADR `decisions/2026-08-11_plan-audit-residuals-termination.md`). Unprocessed dogfood Broad Intake bucket membership is SoT in ADR `decisions/2026-08-11_dogfood-unprocessed-broad-intake-bucket.md` (not the termination policy). Mission Control **Flight Log** is Gaps + operator Warnings with palette-by-type notification chrome (natural Gaps voice; wipe Earlier on new flight; exact `none` for OK, not `none.…` as a yellow debit). When Gaps and Warnings are empty, it may show bounded untriaged review rows (per-row Copy triage / path); it does not host **Review all** / **Resolve all**. Chat `/plan-review-triage` remains HITL SoT
7. **`/run-plan-all`:** mid-batch audits when enabled (findings-only mid-queue; no auto Write residuals); queue-end triage Ask with explicit paths prefers uniform Ack/Fix nits when depth-capped. Throughput knobs: [external plan review](external-plan-review.md#throughput-vs-coverage-operator-knobs)

Claude Code on PATH is optional. If disabled or `claude` is missing, the kit continues with a tip and exit 0 (no CI failure). Details: [external plan review](external-plan-review.md).

### Security considerations

**Plan execution runs with sandbox disabled:** The continuous plan execution (`/run-plan`) uses `cursor-agent --sandbox disabled` to access filesystem operations, git commands, and project tools. This is required for the agent to implement code changes and commit to staging. Maintainers should review plan to-dos and registry skills before enabling continuous execution, as these function as direct agent instructions.

### Mission Control production-ship constraints

Mission Control is a **local, single-developer** observability panel. Treat it as loopback-first, not a shared or internet-facing service.

| Constraint | Expectation |
|------------|-------------|
| Bind | Default host is `127.0.0.1` for `/dashboard`. Never silently bind `0.0.0.0` from that path. Opt-in LAN: `/dashboard-broadcast` (CLI counterpart) binds a non-loopback interface only with explicit intent and a required token gate. |
| Network surface | HTTP static files under `dashboard/`, JSON snapshot (`/dashboard-data.json` / `/api/data`), SSE (`/api/events`), and loopback-only allowlisted `PUT`/`PATCH /api/config`. In broadcast mode, static/snapshot/SSE require the session token. No product WebSockets or inbound webhooks. |
| Mutations | UI CTAs are copy-only (clipboard + paste destination). Config write is the only mutation API and stays loopback + allowlist (including when broadcast is active). No git stage, process kill, server restart, or `/git-prod` from the panel. |
| Remote / shared hosting | Multi-user internet / WAN hosting remains rejected. Personal local-only (loopback-first) is the **default**. Opt-in personal LAN broadcast (`/dashboard-broadcast` + token) is supported for a single operator on a trusted LAN; printed Share URLs are cosmetic fragment masks (ADR below), not relays. |
| Resources | Cold snapshot and periodic refresh use local CPU/IO (`git`, `ps`, filesystem). Do not throttle SSE/poll to "save" Cursor Agent quota; quota levers are named model + `interTickCooldownMs` (see tip under `/run-plan` above). |

**Copy-only actions:** The panel copies text and names where to paste it: repository-relative paths go to the editor's file picker, slash commands go to the chat input, and past-chat references go to the past-chat picker. The panel cannot open a file or a chat, so no label claims that it can.

Source of truth: `.cursor/memory/decisions/2026-07-27_mission-control-personal-local-only-posture.md` (default product goal), `.cursor/memory/decisions/2026-07-27_mission-control-opt-in-lan-broadcast.md` (opt-in LAN path), `.cursor/memory/decisions/2026-08-11_mission-control-broadcast-url-mask.md` (cosmetic Share URL), plus `.cursor/memory/decisions/2026-07-24_mission-control-local-only-security.md` and `.cursor/memory/decisions/2026-07-26_mission-control-config-write-allowlist.md` (technical guards).

**Where the panel runs:** Consumer `npx` / `install.md` installs kit L0 (including the `/dashboard` command text) but **does not** copy `dashboard/**` into the app tree. Snapshot root is always the operator workspace. The UI host is either (1) a published `@dadado/agent-kit-cli` that ships `dashboard/**` (Path C, 4.8.2 onward), or (2) an agent-kit checkout (`MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME` / sibling `../agent-kit` / monorepo `dashboard/`). Start with `/dashboard`, `npm run dashboard`, `agent-kit dashboard`, or `node dashboard/start.mjs` (see root README). Several workspaces may run concurrent instances: each gets a stable listen port from its repo root (see printed URL / `system.port`); Mission Control never kills another workspace's listener.

**First failure (no `dashboard/start.mjs`):** the installed CLI is older than 4.8.2 (4.8.0 has no Path C assets; 4.8.1 was never published). Upgrade to 4.8.2+, or point env/sibling at a kit tree. Do not expect Port B alone to place the panel binary in the project.

The exact git steps behind staging and production live in `autogit/gitupdate.md`; plan modes in `autogit/plan-routine.md`. Both are installed with the kit. Native hooks are listed in [layers-spec.md](layers-spec.md) (L0).

## Working on Agent Kit itself

Maintainer setup, local CLI workflows, factory self-consumer refreshes, and Mission Control from a kit tree are documented in [DEVELOPMENT](DEVELOPMENT.md). This guide covers the consumer workflow after installation.

See the root [README](../README.md) for the big picture and [CONTRIBUTING](CONTRIBUTING.md) for how changes flow.
