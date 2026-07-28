# Command: /run-plan

## Goal

Run the **active plan** continuously until it is done or blocked. One command; the agent picks the execution strategy. The user should not have to choose between "loop" and "orchestrated": hit `/run-plan` and follow the plan panel.

**Apply Agent Persona chrome.** Read `.cursor/context/config.json` for `agentPersona.modes.run-plan` (fallback to legacy `workspaceSkin`, then "night-shift"). Use the corresponding persona's `chatHints` from `registry/personas/core/` for tone and progress updates.

**Never** `/git-prod` in this mode; production only with explicit confirmation (HITL).

## Strategy selection (automatic)

| Condition | Strategy |
|-----------|----------|
| Task / subagent support available (e.g. Cursor) | **Orchestrated** (default): thin main window dispatches workers for heavy to-dos; **inline-first** for lightweight docs-only to-dos (see below) to save Task quota |
| No Task support | **In-session loop**: the session agent implements each tick itself; warn the user the window will grow |
| Headless / CI / cron | **External runner** `agent-kit run-plan` (or `scripts/plan-loop.sh` wrapper): each tick is a fresh agent (see "Headless runner" below) |

Announce the chosen strategy in the first tick response. Do not ask the user to pick.

`/run-plan-loop` and `/run-plan-orchestrated` are **deprecated aliases**: they follow this command, forcing the in-session or orchestrated strategy respectively.

## When to Use

- The user asked for a continuous run / "run it to the end"
- They want automatic staging per to-do (1 topic ~= 1 MR)

Manual mode (`/continue-plan`) stays for one-phase-per-chat with a human gate between units.

## Precondition

- A plan exists in `.cursor/plans/` with to-dos in the frontmatter
- No plan: create one via `/start-project` / plan-routine **before** running; Agent Kit **starts from the plan**

## Continuous mode (override)

While `/run-plan` is active, it **overrides** the "1 phase = 1 chat / ask for a new conversation" rule. Still required:

1. Update the plan's to-dos on every state change (visible in the Cursor panel)
2. Update `.cursor/HANDOFF.md` at the end of **every** tick
3. Memory WRITE for non-obvious decisions/errors
4. Stop and ask on risk (prod, PII, ambiguous scope, secrets)
5. Stop on API / usage hit limit (no silent model fallback); HANDOFF + operator message; revert to-do to `pending`; do not reschedule the next tick

## Tick contract (all strategies)

### 1. Read state

- `.cursor/HANDOFF.md` (required)
- Active plan in `.cursor/plans/` (frontmatter `todos`)
- Context Pack `.cursor/context/current/` if it exists
- Memory CHECK if the phase touches a known error/decision
- **Pre-flight (API-limit stop):** if HANDOFF Gaps / Instruction / stop reason indicates an API/usage limit hard stop from a prior tick, **do not** mark a to-do `in_progress` or dispatch a Task until the operator confirms recovery (named model switch and/or wait for reset). Pre-flight is this HANDOFF check plus operator model choice only; the kit has **no** remaining-quota API. Align with `context-guardian` quota-blocked sessions.
- **Audits pre-flight:** read `externalPlanReview.preflight` (`off` | `warn` | `block`; missing = `off`). When not `off`, check owed / untriaged audits for the active plan slug (Field Report owed, untriaged monitors, cadence WARNING). `warn`: surface once then continue. `block`: arm the launcher (prefer `--autonomous` when `mode: autonomous`, else `--paste-only`) or stop until deferred; never steal `/git-prod`. Stronger than advisory monitor skim (ADR `2026-07-27_audits-autonomous-plan-review-contract.md`).

### 2. Choose the next to-do

Frontmatter order. Skip `completed` / `cancelled`. Mark the to-do `in_progress` in the plan **before** implementing or dispatching.

Optional per-to-do budget fields (`read_scope`, `worker_contract`, `max_ticks`, `worker_type`; see `autogit/plan-routine.md` section 6) apply in every strategy. If `max_ticks` is reached on a to-do: HANDOFF + ask for a new conversation, even mid-run. `max_ticks` exceeded does **not** authorize `/git-prod`.

**Stop (do not schedule the next tick) if:**

| Condition | Action |
|-----------|--------|
| Next to-do is an external **blocker** with no versionable workaround | HANDOFF + clear message; `/git-staging` only if there is a diff |
| All implementable to-dos are `completed` | Final HANDOFF; suggest `/git-prod` if staging is ahead of `main` (HITL only, never auto). Then optional external plan review arm (below) |
| The user asked to stop | Do not reschedule |
| API / usage hit limit (quota, rate-limit signal, Task dispatch failure, auto model switch) | Hard stop: revert to-do to `pending`; HANDOFF with stop reason + cursor; operator message to wait for reset or switch off Auto to a named model (Claude Opus / Sonnet 4.6 / Composer 2.5 Fast); do not reschedule next tick; do not invent progress; do **not** silent-inline the aborted tick (ignore-unless-lightweight still applies after recovery) |
| Prior HANDOFF still records an API/usage limit hard stop (Gaps / Instruction / stop reason) and operator has not confirmed recovery | Refuse auto-reschedule and refuse new Task dispatch; surface recovery options; wait for explicit `/continue-plan` or `/run-plan` after named-model switch or quota wait |
| Diff requires a human decision (scope, prod risk, PII) | Pause and use **Ask questions** tool to ask (options: `Continue with risk` / `Modify approach` / `Stop run`); fallback to chat if tool unavailable |

#### Optional external plan review (plan exhausted only)

After Final HANDOFF when the run stopped because all implementable to-dos are done (`Mode: STOPPED` / plan exhausted, any strategy), and **after** suggesting `/git-prod` if staging is ahead of `main` (that suggestion is a **separate** HITL gate; never steal `/git-prod` confirmation):

**Consumer advisory (before arm/Ask):** briefly consult related `.cursor/memory/plan-monitor-*.md` / owed Field Report state for the exhausted plan slug. Do **not** weaken audits pre-flight, mid-batch policy, or CI headless behavior (ADRs `decisions/2026-07-27_plan-monitor-consumer-awareness.md`, `decisions/2026-07-27_audits-autonomous-plan-review-contract.md`).

1. Read `.cursor/context/config.json` for `externalPlanReview`.
2. **Prefight (before arm or Ask):** confirm these exist relative to the repo root:
   - Launcher: `.cursor/scripts/plan-external-review.sh` (or fallback `scripts/plan-external-review.sh`)
   - Prompt: `.cursor/context/templates/plan-external-review-prompt.md`
   - Monitor scaffold: `.cursor/context/templates/plan-monitor.md`
   If any are missing: do **not** claim a review ran. Tell the user to run `agent-kit update --refresh` (templates are L0; older manifests that listed `.cursor/context/**` as protected blocked them until the kit normalizes that glob). Manual `/plan-external-review` only after the files exist. Skip the Ask/arm below.
3. **If `externalPlanReview.enabled === true` (chat session):** do **not** exec headless `claude -p` in the agent shell.
   - When `mode` is `autonomous` (or missing but operator passed `--autonomous`): run `.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor <plan>` (background/inspectable PTY + wait; not silent agent-shell `-p`). Soft-fail / missing `claude` → tip + exit `4` while waiting (or tip + exit 0 only when wait is off); Field Report owed. Do **not** claim an invisible agent-shell audit is running. Spawn-only exit 0 **without** `--wait-monitor` is **not** review done.
   - When `mode` is `paste` or missing (legacy): run paste-prep:
     ```bash
     .cursor/scripts/plan-external-review.sh --paste-only
     ```
     Then show the paste-only user-facing message (review is **not** running until the operator pastes). After paste, wait with freshness (below).
4. **Else if `offerOnExhausted !== false`** (missing or `true`): use **Ask questions** (chat fallback if tool unavailable) with labels exactly:
   - `Run review now`
   - `Always enable automatic`
   - `Not now`
5. **Handlers (chat path, background/inspectable only):**
   - `Run review now`: **MUST NOT** arm silent agent-shell `--force` / `--print` alone (Claude HITL can block invisibly; no monitor appears). Prefer `.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor <plan>` (background PTY auto-launch); else `--force --paste-only` (clipboard only; review is **not** running yet). Honest next-step copy for paste fallback:
        > External review is ready to paste (not running in this chat).
        > 1. Open a **Cursor Terminal** in the repo root.
        > 2. Paste (already on clipboard if `pbcopy` worked):
        >    `.cursor/scripts/plan-external-review.sh --force --interactive <plan.plan.md>`
        > 3. Stay in this chat: after paste, the agent waits for a **fresh** monitor file (do not require typing `done`).
     Do **not** persist `enabled: true`. Do **not** claim a review "started" unless a background/inspectable session was actually launched. Do **not** treat spawn-only exit 0 as review done.
   - `Always enable automatic`: merge `enabled: true` (and prefer `mode: autonomous` when setting defaults for new opt-in) into `externalPlanReview`, then same background/inspectable arming rules as enabled-true above (not agent-shell `-p`; always include `--wait-monitor` on autonomous arm).
   - `Not now`: merge `offerOnExhausted: false` (no nag on later exhaustion). Manual `/plan-external-review` still works.
6. **Post-arm monitor watch + continue (chat required):** after arming, **do not** stop at Final HANDOFF "when the monitor lands, run `/plan-review-triage`" or wait for the operator to type `done`. Chat autonomous arm **always** includes `--wait-monitor`. In the **same session**:
   1. AwaitShell / block on the launcher until exit `0` (fresh monitor ready), `3` (timeout), or `4` (soft-fail while waiting). Wait success requires a **fresh** monitor after arm start (mtime/arm-epoch or content sentinel); pre-existing files are not ready.
   2. On **exit 0:** run `/plan-review-triage` Ask for that monitor path (findings-only; no silent-Ack / auto-fix).
   3. On **timeout / soft-fail (3|4):** honest tip + Field Report owed; do **not** invent a finished review or run triage as if the monitor is ready.
   4. Never claim the audit finished on spawn-only exit 0 or on a stale pre-arm monitor path.
   ADR: `decisions/2026-07-27_audits-wait-freshness-enforce.md` (follow-on to `decisions/2026-07-27_audits-post-spawn-monitor-watch-continue.md`).
7. **Not a native stop hook:** do **not** register or rely on a Cursor `hooks.json` `stop` follow-up. Exhaustion Ask / arm / watch run only after Final HANDOFF / prod suggestion as a separate gate.
8. **Still never `/git-prod`** from this path. Suggesting prod when staging is ahead of `main` stays a human next step (separate from monitor watch and triage Ask).
9. **Headless / CI only:** `agent-kit run-plan` may arm `.cursor/scripts/plan-external-review.sh` or `--force` (print / `claude -p`). That path is not chat; tips/disabled do not fail the loop. Chat and CI stay split on purpose (see memory decision `2026-07-25_external-review-chat-visible-vs-ci-headless`). Post-spawn wait+triage Ask is **chat/session only**.

### 3. Execute only this to-do

Per strategy (below). Never stack the next to-do in the same tick. Keep hygiene: technical commits, no transient content in the repo.

### 4. Review + improvement (optional, if the plan has it)

| Prefix | What to do |
|--------|------------|
| `review-*` | Review deliverables: gaps, security, contracts vs docs. With a **findings contract**, worker writes findings into the plan (see "Findings contracts"); HANDOFF / memory for tradeoffs or fallback gaps only. **Never** auto-fix product code in the review tick. |
| `improvement-*` | Only after the **remediation gate** (below) authorizes a fix path. Apply objective improvements only. No cosmetic refactors. |

If the review finds nothing: mark `improvement-*` as `completed` with a note in the HANDOFF and move on.

#### Remediation gate (`externalPlanReview.autoRemediate`)

After a findings-contract (or `review-*`) tick returns findings, read `.cursor/context/config.json` → `externalPlanReview.autoRemediate` (missing key or missing file = **`false`**).

| `autoRemediate` | Orchestrator action |
|-----------------|---------------------|
| `false` (default) | **Do not** auto-fix product code. Do not treat `improvement-*` as an automatic apply. Choose: (1) **small/contained** → dispatch a separate **fix-agent** Task (implement to-do or explicit improvement unit), or (2) **large/multi-touch** → write or enqueue a **residuals backlog plan** (Ask when HITL is required). Record the choice in HANDOFF Gaps or Instruction. |
| `true` | Review workers stay findings-only. Orchestrator **may** dispatch a fix-agent Task for small nits without an extra Ask; large/multi-touch still becomes a residuals plan. External-monitor path still requires `/plan-review-triage` before product edits. |

**Invariant:** the review worker never edits product source, configs, or tests unless the to-do text explicitly authorizes product edits. `autoRemediate` only gates what the **orchestrator** does after findings exist.

### 5. Close the tick: status + staging

1. Mark the tick's to-do as `completed` in the plan's frontmatter
2. Update `.cursor/HANDOFF.md` (include `Mode: run-plan (<strategy>)`)
3. **Cadence ledger:** run `.cursor/scripts/field-report-cadence-bump.sh tick` (increments the gitignored Field Report activity counter; may open a cadence warning when threshold + unreviewed work). Never commit the ledger. ADR: `2026-07-27_field-report-activity-review-cadence.md`.
4. If `git status` has commitable changes **and** it is not just a trivial HANDOFF/memory update: run the `/git-staging` routine **without asking for confirmation** (authorized by this command); 1 MR/PR -> staging branch -> merge. **Monitor hygiene:** if untracked or unrelated dirty `.cursor/memory/plan-monitor-*.md` appear, warn and stage product (and intentional memory) files **add-by-name only**; never broad `git add` of `.cursor/memory/` WIP into a product commit.
5. No commitable diff: just HANDOFF + plan status

### 6. Reschedule or stop

- Implementable to-dos remain: schedule the next tick (Loop skill / short delay) with the wake prompt below
- **Optional cooldown (`interTickCooldownMs`):** when `.cursor/context/config.json` has a value `> 0`, the loop or orchestrator waits that many ms between ticks. **Default remains `0`** (no cooldown) so named-model / fast runs are not silently slowed. Set via Mission Control **Config** (More menu) or edit `.cursor/context/config.json` (see `config.example.json`).
- **Auto continuous runs:** if the operator stays on **Auto** for `/run-plan`, strongly recommend a non-zero cooldown before starting (documented recommend: **15000** ms). Default stays `0`; this is operator opt-in, not a silent global slowdown.
- **First-tick Auto surface (when cooldown is `0`):** on the **first** tick of a continuous `/run-plan` (or when resuming after an API-limit stop), if `interTickCooldownMs` is missing or `0` and the operator appears to be on **Auto**, briefly surface the 15000 ms recommend in the tick response (Config or `config.json`). Do **not** change the global default. Named-model runs need no nag.
- **Adaptive backoff (bounded, prose only):** after a hard stop from quota, the next successful continuous run should start with cooldown ≥ the Auto recommend (15000 ms) until the queue is stable. Do not invent machine-enforced Cursor quota APIs; the orchestrator applies this as documented guidance when resuming.
- In-session loop with a bloating window, or orchestrated with a bloated main window: HANDOFF + ask for a new conversation with `/continue-plan` or `/run-plan`
- Stopped (blocker / done / user stop / API limit): **do not** reschedule; report the reason
- **Do not** throttle Mission Control SSE/poll/dashboard-data as a Cursor Agent quota fix (local-only surfaces; see enforcement audit)

## Model guidance for long runs

When running many to-dos continuously (via `/run-plan` or `/run-plan-all`):

- **Prefer a named model** (Claude Opus, Sonnet 4.6, or Composer 2.5 Fast) over **Auto** for continuous runs. Named models typically use a **separate quota bucket** from Auto (switching does not clear Auto quota) and expose Ask questions for HITL.
- **Auto is high risk for continuous mode:** Auto can deplete its bucket under back-to-back Task dispatch, then silently fall back to models without HITL tools (e.g. Grok 4.5). That compounds recovery (no clickable Asks) and does not mean the to-do completed.
- **If you must run continuous mode on Auto:** set `interTickCooldownMs` to at least **15000** before starting (Mission Control Config or `config.json`). Prefer switching to a named model instead. When cooldown remains `0` on Auto, the first-tick surface (Reschedule section) reminds once without mutating config.
- **Parallel heavy Tasks** are discouraged. The sequential orchestration in `/run-plan-all` (one Task per plan, one plan at a time) is already a mitigation. Tasks that fan out parallel subagents increase API consumption and hit-rate risk. Never co-pack Task with staging Await (Orchestrator turn hygiene).

## Orchestrated strategy (default)

The main window is a **thin orchestrator**: it reads state, dispatches, reviews, writes the HANDOFF, and runs staging. It does **not** implement code or dump diffs/logs.

| Role | Does | Does not |
|------|------|----------|
| **Orchestrator** (main window) | Picks the to-do; marks `in_progress`; dispatches worker **or inline-first implement** (lightweight docs-only); reviews summary; marks `completed`; HANDOFF; `/git-staging` if there is a diff | Implement **product** code; dump diffs/logs; `/git-prod`; **transcribe review findings as the default author** (see Findings contracts) |
| **Worker** (Task) | Executes **only** the to-do; respects `read_scope` if it exists; returns the summary contract; **writes plan findings** when the to-do uses a findings contract | Ask the user for `/continue-plan`; `/git-prod`; stack the next to-do |

### Orchestrator turn hygiene (no co-pack)

**Sequential Task-only at the tick boundary.** In a single orchestrator turn that dispatches a Task:

- **Do not** co-pack Task dispatch with `/git-staging`, AwaitShell waits on staging/MR, or other parallel heavy tool work in the same turn.
- Finish the worker return (or end-of-turn Task notification) **before** starting staging. Staging is step 5 of Close the tick, after the summary is reviewed.
- **Do not** fan out parallel heavy Tasks from the same tick (see Model guidance). One Task per to-do; next tick only after close.

Live residual: Auto quota burns faster when Task and staging Await share one turn. ADR: `decisions/2026-07-27_auto-run-no-regression-invariants.md`.

### Worker routing table

Resolve `subagent_type` in this order: explicit `worker_type` on the to-do, else the signal match below, else `generalPurpose`.

| Signal (to-do content / paths) | Prefer `subagent_type` |
|--------------------------------|------------------------|
| Docs / README / ADR / `docs/` | `docs-repo` |
| Large refactor / deslop / clean-code | `cleancode-refactor` |
| Security audit / auth / PII | `security-reviewer` |
| Explore / map codebase (read-only) | `explore` |
| Shell-heavy (scripts, git plumbing, CI) | `shell` |
| n8n workflows | `n8n-workflows` |
| Postgres / SQL schema | `sql-schema` |
| ClickUp tasks (only if project uses it) | `clickup-tasks` |
| Tech decision / ADR tradeoff | `tech-lead` |
| Memory batch / dedupe | `memory-extractor` |
| Default implement | `generalPurpose` |
| Git promote as **sole** to-do | Main window, or `git-autogit` only if isolation is wanted. **Never** Task for `/git-prod` HITL |

**Fallback:** if the preferred domain agent is **not** installed in this repo, use `generalPurpose` and tell the worker which **skill** to follow (path under `.cursor/skills/` or `registry/skills/`). Do not invent a `subagent_type`.

### Inline-first lightweight to-dos (quota mitigation)

Subagent delegation saves main-window context but **each Task dispatch bills Cursor Agent quota** (including failed dispatches). For docs-only close-out ticks (CHANGELOG, memory index, HANDOFF notes), prefer **in-session implement in the orchestrator** instead of Task when the to-do qualifies.

**`inline_first` is not force-inline.** It is an **opt-in signal** that still requires **every** lightweight check below. When any check fails, **ignore** `inline_first: true` and treat the tick as **Task** (or use `/continue-plan` in-session by operator choice). Do **not** expand inline-first for `security-reviewer` / `tech-lead` / `explore` / product `read_scope` just because the deliverable is an ADR. Do **not** silently fall back to inline implement after a Task API-limit abort on the same to-do (hard stop stays intact; recover, then resume). ADR: `decisions/2026-07-27_run-plan-inline-first-qualification-gap.md`.

**Resolution order (before dispatch):**

1. `force_task: true` on the to-do → **Task** (always)
2. Findings contract (see below) → **Task** (worker must author plan findings)
3. `inline_first: false` on the to-do → **Task**
4. Qualifies as **lightweight** (all rows below) → **inline-first** (orchestrator implements this tick; announce `Run orchestrated + inline-first: [to-do-id]`)
5. Else → **Task** (including when `inline_first: true` was set but lightweight checks failed: flag is ignored)

**Lightweight qualification (all must pass):**

| Check | Rule |
|-------|------|
| Worker type | `worker_type` absent, or `docs-repo`, or `memory-extractor` only. Any other type (`explore`, `security-reviewer`, `tech-lead`, `cleancode-refactor`, `shell`, …) → not lightweight; `inline_first` ignored |
| Findings | `worker_contract` must **not** match a findings contract |
| `read_scope` | Absent, **or** every path is docs-only (allowlist below). Any product-code path → not lightweight; `inline_first` ignored |
| Opt-in signal | `inline_first: true` does **not** bypass the three checks above. When absent, still allow inline-first if the three checks pass (quota-friendly default for docs close-out). When present but any check fails → **Task** |

**Docs-only `read_scope` allowlist** (prefix or exact match):

- `CHANGELOG.md`, `README.md`, `AGENTS.md`
- `docs/**`
- `.cursor/memory/**`
- `.cursor/HANDOFF.md`
- `.cursor/plans/**`
- `.cursor/commands/**`, `.cursor/rules/**`, `.cursor/context/templates/**` (L0 markdown only)

**Product paths (any in `read_scope` → Task required):** `packages/**`, `dashboard/**`, `registry/**`, `hooks/**`, `git-hooks/**`, `install.md`, and any `**/*.{ts,tsx,js,mjs}` outside `docs/`.

**Inline-first tick contract:** same as in-session for that to-do only: follow `read_scope`, `worker_contract`, docs-repo skill if applicable, lint-before-staging-ready, update plan status, HANDOFF, `/git-staging` on diff. Do **not** stack the next to-do. Findings-contract authorship rules do not apply (orchestrator writes versioned memory/CHANGELOG, not review findings tables).

**After an API-limit HANDOFF stop:** recover first (named model and/or wait; pre-flight refuse until confirmed). Then prefer `/continue-plan` or a **re-authored qualifying** docs tick (`docs-repo` / allowlisted `read_scope`, optionally `inline_first: true`). Do **not** invent progress by inlining the aborted non-qualifying Task.

Cross-link: `decisions/2026-07-27_run-plan-inline-first-lightweight-todos.md`, `decisions/2026-07-27_run-plan-inline-first-qualification-gap.md`, `decisions/2026-07-27_api-limit-enforcement-levers.md`.

### Findings contracts (review workers)

Some to-dos are **review-only**: they produce evidence-backed findings, not product code. When `worker_contract` matches a **findings contract**, the orchestrator must treat plan-file writes as a first-party worker deliverable, not orchestrator transcription.

**Findings-only (hard rule):** review workers **report** structured findings (severity, path, evidence). They **must not** auto-fix product code. Remediation is an orchestrator decision under the **Remediation gate** (`autoRemediate`); never silent apply inside the review tick.

**Detect a findings contract** when any of these is true:

| Signal | Examples |
|--------|----------|
| `worker_contract` contains `findings` | `summary + findings list (severity, path, evidence)` |
| `worker_contract` names a plan-body artifact | `summary + backlog table in plan body`, `summary + decision text` |
| To-do id or content prefix | `review-*`, `consolidate-*`, Phase text like "Review only" / "Merge all review findings" |

**Dispatch (orchestrated strategy):**

1. **Write access is the default.** Dispatch the worker with permission to edit the active plan (or an agreed artifact path named in the to-do / `read_scope`). Do **not** default to ask/read-only mode for findings to-dos.
2. **Worker is the author.** The worker writes findings into the plan section for that phase (table or structured list with id, severity, path, evidence). The orchestrator reviews the worker summary and spot-checks the written section; it does **not** re-type findings from the summary as the primary path.
3. **Thin orchestrator still holds for product code.** Workers with findings contracts may edit `.cursor/plans/*.plan.md` (or the agreed review artifact). They must **not** edit product source, configs, or tests unless the to-do explicitly says so.
4. **Fallback only when write fails.** If the worker returns without writing (mode block, tool failure, out of scope): the orchestrator may transcribe from the worker summary **once**, prefix the plan section with `(secondhand: orchestrator transcription; worker could not write)`, and record the gap in HANDOFF under **Gaps** so a later to-do or manual pass can fix authorship.
5. **After findings exist:** apply the **Remediation gate** (section 4). Do not stack product fixes into the review worker's tick.
6. **Durable home (versioned).** Plan files are gitignored; chat-only or plan-only findings are not reviewable from git. At consolidate or plan close, persist the final backlog to `.cursor/memory/plan-review-<plan-slug>.md` and add a row to `_index.md` **Audits**. Convention: `decisions/2026-07-25_plan-review-findings-durable-home.md`.

**In-session loop / manual mode:** the session agent follows the same authorship rule: write findings into the plan (or agreed artifact) in the same tick; do not leave findings chat-only; do not auto-fix product under `autoRemediate: false`. On close, write or update the memory audit.

Cross-link: findings contract field semantics in `autogit/plan-routine.md` section 6; config key `externalPlanReview.autoRemediate` in `docs/external-plan-review.md`.

### Worker prompt template

Self-contained; the worker does **not** inherit the main window's transcript.

```text
You are an Agent Kit worker. Execute ONLY the to-do below and stop.

Repo: <path>
Plan: .cursor/plans/<file>
HANDOFF (summary): <phase / next>
To-do id: <id>
To-do: <content>
worker_type / subagent_type: <name>
skill fallback (if any): <path or "none">
read_scope (if any): <globs, read only what is necessary outside this>
max_ticks for this to-do (if any): <N>
worker_contract (if any): <string>

Rules:
- Implement only this to-do; do not stack the next one
- Update the plan's frontmatter status (in_progress -> completed) if the orchestrator has not done it
- Hygiene: technical commits/docs; no transient content
- Do not expect a broad `git add` of `.cursor/memory/plan-monitor-*.md` WIP into a product commit (orchestrator stages monitors add-by-name only when intentional)
- Never /git-prod
- Do not ask the user for /continue-plan
- Before Staging ready: yes: run repository-appropriate formatter/linter on touched files (e.g. biome/eslint/prettier for code; markdownlint or docs tests if the repo has them). Do not require a global lint for pure markdown when no applicable linter exists; state none applicable in Tests/Validation.
- Summary MUST include Tests: or Validation: with commands and results (pass/fail). Staging ready: yes without that evidence is invalid when you changed formatted/linted files.

Findings contract (if worker_contract matches — see "Findings contracts" in this command):
- You have write access: append or update this phase's findings section in the active plan (or artifact path named in read_scope / to-do). You are the first-party author.
- Use structured findings (id, severity, path, evidence). Review only unless the to-do explicitly authorizes product edits.
- Findings-only: do NOT auto-fix product source, configs, or tests. The orchestrator decides remediation (fix agent vs residuals plan) via autoRemediate.
- If you cannot write the plan file, say so in Gaps; do not assume the orchestrator will transcribe silently.
- If you also edit formatted/linted product or test files, lint evidence still applies. Plan-only markdown with no applicable linter: state none applicable.

Return ONLY the summary contract (no diff/log dump):
## Worker summary
- Todo: <id>
- Changed: <paths or "none">
- Gaps: <none | short list>
- Staging ready: yes|no
- Notes: <1-2 optional sentences>
- Tests: <commands + results, or "none applicable">
```

Prefer `run_in_background: false` so the orchestrator reviews the return in the same tick.

### Review the return

- Does the summary match the format? Any blocking gaps?
- **Staging-ready lint gate:** if `Staging ready: yes` and the to-do changed formatted/linted files, require `Tests:` or `Validation:` with applicable formatter/linter commands and pass results. Reject (re-dispatch once, or mark not staging-ready) when lint evidence is missing. Pure markdown / docs-only with no repo linter: allow yes when the summary states none applicable. Do not demand a full-repo lint when focused checks on touched files suffice. Background: post-merge format PRs (`plan-monitor-dashboard-field-report-and-skins.md`; errors `2026-07-21_ci-biome-blocked-440-publish.md`, `2026-07-23_biome-format-blocked-446-tag-ci.md`).
- **Findings contract:** confirm the worker wrote the plan section (or agreed artifact). If missing and the summary carries findings, use the **fallback transcription** path once (label secondhand; note gap in HANDOFF). Do not treat chat/summary-only findings as done. Findings authorship rules are unchanged; lint gate applies only when formatted/linted files were also edited.
- **Remediation gate:** if the worker returned findings, read `autoRemediate` and follow section 4 (no silent product fix when false; fix-agent vs residuals plan). Reject a review-worker summary that changed product paths unless the to-do explicitly authorized product edits.
- Worker failed or went out of scope: fix with **one** focused re-dispatch, or pause and ask; do not implement product code in the main window
- Thin orchestrator invariant: if the main window starts editing **product** feature code, that is wrong; dispatch again or degrade to the in-session loop. **Exception:** inline-first lightweight to-dos (docs-only allowlist above). Plan-file writes for findings contracts remain Task-only unless fallback transcription applies.

## In-session loop strategy (fallback)

Used when Task / subagents are not available. The session agent implements each tick itself; the window grows each tick (accepted cost, tell the user once). Everything else follows the tick contract above.

## Wake prompt (next tick in the same session)

```text
/run-plan - next tick. Read HANDOFF + plan. Mark the next to-do in_progress. Orchestrated: dispatch a worker (Task), do NOT implement in the main window. No Task: implement in-session. On close: completed in the plan + HANDOFF + git staging if there is a diff. Stop on external blocker or exhausted plan. Do not ask the user for /continue-plan. Never git prod.
```

## Response to the user (per tick)

Short, trackable:

> Run [strategy]: [to-do id]. Done: .... Plan: [N completed / total]. Staging: [PR #N / no diff]. Next: ... | **Stopped:** [reason]

## Stop

User: "stop" / "stop the run" -> do not reschedule; HANDOFF with current state.

## Headless runner (`agent-kit run-plan`)

For CI / cron / terminal runs. Canonical entrypoint: **`agent-kit run-plan`** (TypeScript CLI). `scripts/plan-loop.sh` is a thin wrapper that forwards to the CLI. Each tick runs in a **fresh headless agent** (clean context window); rescheduling is done by the runner, not the session:

- **Do not** use the Loop skill / do not reschedule internally; execute one to-do and finish.
- End the response with exactly one line: `LOOP_TICK_RESULT: continue` or `LOOP_TICK_RESULT: stop - <reason>`.
- Everything else in the tick contract applies: one to-do per tick, plan status, HANDOFF, `/git-staging` if there is a diff, **never** `/git-prod`.
- Stop mid-run: `touch .cursor/loop.stop` or Ctrl+C.
- Options: `--max-ticks N`, `--model M`, `--sleep S`, `--backend cursor-agent|claude`, `--dry-run`. Default backend is `cursor-agent` (`claude` reserved for a later wiring).
- **Tick close / plan exhausted:** when the runner stops because pending to-dos are 0 or the agent sentinel is `stop - plan exhausted` (or equivalent), the CLI arms the external review launcher in **headless** mode (prefer `.cursor/scripts/plan-external-review.sh`, fallback `scripts/`; opt-in + `claude` checks inside the script; `--force` = `claude -p`). Disabled / missing `claude` → tip + exit 0; the loop still exits 0. This is not a Cursor `stop` hook and never runs `/git-prod`. Chat exhaustion Ask is session-only and **must** use background/inspectable arming (`--force --autonomous --wait-monitor` or `--force --paste-only`), never silent agent-shell `--force` / `--print` from the chat agent shell.

## HITL (invariants)

- `/git-prod` **never** from this command, any strategy
- Risk (PII, secrets, ambiguous scope): stop and ask
- Human gate between phases only in manual mode (`/continue-plan`); `/run-plan` is the explicit opt-out
- Optional external plan review after exhaustion (auto-arm or Ask) does **not** replace or auto-confirm `/git-prod`; Ask only after Final HANDOFF / prod suggestion as a separate gate
