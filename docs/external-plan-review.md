# Plan audits (external plan review)

Optional post-completion **audits** of shipped work against the original plan using Claude Code CLI. When a plan finishes all implementable to-dos, get evidence-based gap detection from a second agent without interfering with the original execution flow. Config object key remains `externalPlanReview` for compatibility; L0 and docs prefer the product name **audits**.

L0 ships the commands, templates, launcher, and `config.example.json` with the base install. The feature stays **opt-in** (`enabled: false` by default). Claude Code is never required for install or CI; a missing `claude` binary or missing prompt template yields a tip and exit 0.

**Install note:** session L3 protection covers `config.json`, `current/**`, and `backups/**` only. If an older manifest still lists `.cursor/context/**`, `agent-kit update` expands that glob so templates can install. If the prompt file is missing after a fresh offer, run `agent-kit update --refresh` and re-arm.

## Setup

1. **Enable configuration** (or accept Enable when a plan reaches exhaustion):
   ```json
   // .cursor/context/config.json
   {
     "externalPlanReview": {
       "enabled": true,
       "backend": "claude",
       "autoRemediate": false,
       "offerOnExhausted": true,
       "mode": "autonomous",
       "midBatchAudits": true,
       "preflight": "warn"
     }
   }
   ```

2. **Install Claude Code CLI** (optional): Follow Claude's installation guide so `claude` is on PATH when you want auto-arm or headless review.

## Workflow

### 1. Run plan to completion

Use `/run-plan`, `/run-plan-all` (per queued plan), or manual `/continue-plan` until all implementable to-dos are completed.

### 2. External review triggers

**Automatic (when enabled):** When `/run-plan` reaches plan exhausted, the kit arms the canonical launcher:

```bash
# Chat / session (mode autonomous): background/inspectable PTY auto-launch
.cursor/scripts/plan-external-review.sh

# Headless agent-kit run-plan always passes --print
.cursor/scripts/plan-external-review.sh --print
```

A thin wrapper at `scripts/plan-external-review.sh` remains for dogfood and older docs; prefer `.cursor/scripts/`.

**Exhaustion Ask (when not yet enabled):** If `enabled` is false and `offerOnExhausted` is not false, chat `/run-plan` may Ask once-style:

- `Run review now` (one-shot via `--force --autonomous` when background spawn is available; `--force --paste-only` as fallback/legacy; never silent agent-shell `--print` from the chat agent shell)
- `Always enable automatic` (sets `enabled: true`, then same autonomous or paste UX per `mode`)
- `Not now` (sets `offerOnExhausted: false`; manual command still works)

Onboard also offers a light Ask after Agent Persona: `Enable Claude external review` / `Skip for now`.

**Chat vs CI:** When `externalPlanReview.mode` is `"autonomous"`, chat/session arms spawn interactive Claude in an **inspectable background/headless PTY** (tmux/screen preferred; macOS Terminal.app `do script` without `activate`; Linux/Windows emulator as last resort). No copy/paste is required. OS window focus is not the happy path (`--focus-terminal` / `AGENT_KIT_AUDIT_FOCUS_TERMINAL=1` restores activate). If background spawn fails or the operator opts out, `--paste-only` remains the fallback. Missing `mode` keeps paste-compatible / legacy behavior so existing installs do not suddenly auto-launch. Headless `agent-kit run-plan` always passes `--print` (`claude -p`) and sets `AGENT_KIT_HEADLESS=1`. Agents must not claim an audit is "running" via silent agent-shell `-p`. Background PTY is honest; agent-shell `-p` is not (ADR `.cursor/memory/decisions/2026-07-28_audits-headless-terminal-honesty.md`).

**Activity cadence (Field Report):** After a configurable number of completed `/run-plan` ticks (default 3) or each `/run-plan-all` queue completion, Mission Control may show a warning with a **batch** command covering all still-unreviewed plans (`--batch`) plus per-plan lines. Under autonomous mode the orchestrator arms without a paste Ask; paste-only remains the soft-fail path. Agents bump the gitignored ledger via `.cursor/scripts/field-report-cadence-bump.sh`. Config: `fieldReportReviewCadence.enabled` / `tickThreshold`. ADR: `.cursor/memory/decisions/2026-07-27_field-report-activity-review-cadence.md`.

**Manual:** Use `/plan-external-review` anytime after completion.

#### `/run-plan-all`

When `midBatchAudits` is true (preferred with `mode: "autonomous"`), `/run-plan-all` arms a **full audit after each queued plan completes** (before advancing the cursor) **and** a queue-end batch arm for remaining owed/unreviewed targets. Arms use the autonomous background/inspectable launcher (no paste Ask mid-queue). Mid-queue **operator** non-stop is preserved: do not insert paste/Ask gates; do not steal `/git-prod`. When an audit soft-fails (missing `claude`, spawn unavailable), Field Report **owed** remains the ledger. Missing or false `midBatchAudits` preserves queue-end / owed-ledger behavior for paste installs. Suggest `/git-prod` as separate HITL after the queue. ADR: `.cursor/memory/decisions/2026-07-27_audits-autonomous-plan-review-contract.md` (supersedes queue-end-only).

### 3. Claude Code monitors

The script launches Claude Code with context about:

- Completed plan file (`.cursor/plans/*.plan.md`)
- Current git commit
- HANDOFF status
- Shipped deliverables vs original scope

Claude writes an evidence-based monitor to `.cursor/memory/plan-monitor-{plan-slug}.md` with:

- Conformance check (plan vs shipped work)
- Gap analysis (missing pieces, scope drift)
- Quality assessment (implementation vs requirements)
- Residual recommendations

### Consumers of plan-monitors (read-only)

Monitors are durable evidence. Beyond Field Report and `/plan-review-triage` (attention/HITL SoT), these surfaces **consult** theme-matched `plan-monitor-*.md` (and `plan-review-*` audits) without changing detection or review arming:

| Surface | Role |
|---------|------|
| `/start-project`, `/backlog-add`, `/plan-review-triage` Write residuals Broad Intake | Memory bucket + **Unprocessed dogfood** (`dogfood/README.md` or `.cursor/dogfood/README.md`, `##` or `### Unprocessed Files`) + worker `read_scope` include monitors/audits and dogfood paths; same triage labels (`ignore` / `error` / `include` / `note`) |
| `/continue-plan` | Pre-unit advisory skim for the chosen plan slug |
| `memory-loop` CHECK | Glob monitors/audits before deep re-investigation |
| `/git-staging` | Dirty untracked monitor warn; add-by-name only |
| `/git-prod`, `/run-plan` exhaustion | Short advisory only; never steal prod HITL or change arming |

ADR: `.cursor/memory/decisions/2026-07-27_plan-monitor-consumer-awareness.md`.

### 4. Triage findings

Use `/plan-review-triage` to process the monitor with clickable options:

- **Write residuals plan:** Run the same Broad Intake as `/backlog-add` (buckets + triage labels), propose a residuals plan from Still open plus intake findings, confirm with Ask (`Write plan to backlog` / `Modify` / `Cancel`), write `.cursor/plans/*.plan.md` and append HANDOFF Backlog (no Gate B; `/start-project` is an optional escape hatch only). **Termination:** max closeout depth 1 per theme family; prefer **Ack and stop** / **Fix nits only** for nits or process-only Still open; do not mint unbounded `close-*` plans (ADR `decisions/2026-08-11_plan-audit-residuals-termination.md`)
- **Fix nits only:** Address small issues directly (typos, formatting, obvious omissions)
- **Ack and stop:** Note findings for future reference without immediate action

Mission Control **Flight Log** shows HANDOFF Gaps (**NOW** + **Earlier** history; wipe on new plan/queue flight; cap 15 within a flight) plus an operator Warnings lane (Quota pause, Heads up), with palette-by-type notification chrome (`ok` / `advice` / `prompt` / `residual` / `warning`). When Gaps and Warnings are empty, Flight Log may surface bounded untriaged external-review rows (per-row **Copy triage command** button whose payload is `/plan-review-triage <path>`; All clear when truly clear). Every Flight Log entry kind renders **one dynamically-labeled action button** whose payload composes the act-on-the-matter prompt with the referenced document path (`Copy fix prompt` for Gaps NOW/Earlier, `Copy recovery prompt` for Quota pause, `Copy follow-up prompt` for Heads up, `Copy triage command` for quiet open-triage); the toast names the chat input as paste destination (ADR `2026-07-27_mc-flight-log-panel.md` decisions 11/13 amendment). Write Gaps in short operator voice (exact `none` when only mid-batch/cadence plumbing changed; avoid `none.…` OK notes; see handoff template). External-review triage decisions run via chat `/plan-review-triage` (HITL SoT; autonomous audit arming), not as Review all / Resolve all CTAs on that card. Multi-path walks skip already-triaged or no-open-residual monitors with a one-line note. When remaining monitors share a uniform outcome class, `/plan-review-triage` uses **one** Ask for the set and still writes a durable triage heading on every target; uniform Write residuals runs one Broad Intake then may enqueue one combined backlog plan. Mixed outcomes stay sequential (ADRs `2026-07-27_plan-review-triage-batch-uniform-hitl.md`, `2026-07-28_triage-write-residuals-via-backlog.md`). Cadence ledger scripts may remain for L0 tick bumps; Flight Log UI does not surface cadence WARNING rows (ADR `2026-07-27_mc-flight-log-panel.md`). Wait/mtime and mid-batch wait are owned by the wait-freshness contract (`2026-07-27_audits-wait-freshness-enforce.md`).

## Configuration options

```json
// .cursor/context/config.json
{
  "externalPlanReview": {
    "enabled": false,
    "backend": "claude",
    "autoRemediate": false,
    "offerOnExhausted": true,
    "mode": "paste",
    "midBatchAudits": false,
    "preflight": "off"
  }
}
```

| Field | Meaning |
|-------|---------|
| `enabled` | Auto-arm on plan exhaustion (default: false) |
| `backend` | External agent type (default: `"claude"`) |
| `autoRemediate` | When `false` (default): review workers and external Claude stay findings-only; `/run-plan` must not auto-fix product code after findings (fix-agent Task for small nits, or residuals backlog plan for large). When `true`: review workers remain findings-only; orchestrator may dispatch a fix agent for small nits without an extra Ask. External-monitor path still requires `/plan-review-triage` before product edits. |
| `offerOnExhausted` | When `enabled` is false, allow exhaustion Ask until Always or Not now (default: true) |
| `mode` | Audits arming path: `"paste"` (legacy clipboard/paste into Cursor Terminal) or `"autonomous"` (background/inspectable PTY auto-launch when enabled). Missing key keeps paste-compatible behavior for existing installs. Greenfield example may show `"autonomous"`. |
| `midBatchAudits` | When true, `/run-plan-all` runs full audits mid-queue (after each plan) and at queue end via the launcher `--batch` path. Prefer true under `mode: "autonomous"`. Missing or false preserves queue-end / owed-ledger behavior for paste installs. |
| `preflight` | Audits pre-flight on plan-run commands (`/continue-plan`, `/run-plan`, `/run-plan-all`, `/hotfix`, …): `"off"` (default when missing), `"warn"` (surface once), or `"block"` (arm or stop until owed audits are launched or explicitly deferred). Enforced in L0 (`continue-plan`, `run-plan`, `run-plan-all`, `hotfix`, HITL gate table). |

### Throughput vs coverage (operator knobs)

Example defaults in `config.example.json` favor **coverage** under autonomous mode (`midBatchAudits: true`, `offerOnExhausted: true`, `preflight: "warn"`) without silently turning audits off. Reduce conveyor cost without abandoning review:

| Goal | Knob | Effect |
|------|------|--------|
| Fewer mid-queue Claude arms | `midBatchAudits: false` | Queue-end / owed ledger only; triage still applies when monitors exist |
| Less exhaustion nag | `offerOnExhausted: false` | No chat Ask when disabled; manual `/plan-external-review` still works |
| Soft pre-run pressure | `preflight: "off"` \| `"warn"` \| `"block"` | `off` skips; `warn` surfaces once; `block` arms or stops |
| Stop residual spawn loops | Triage termination (L0) | Max closeout depth 1; Ack/Fix nits preferred for process-only; never silent-Ack Blocking (ADR `decisions/2026-08-11_plan-audit-residuals-termination.md`) |

Do **not** flip `autoRemediate` to `true` as a shortcut for fewer backlog plans; that weakens findings-only HITL. Prefer Ack / Fix nits / depth gate at `/plan-review-triage`.

## Script options

Canonical launcher: `.cursor/scripts/plan-external-review.sh` (wrapper: `scripts/plan-external-review.sh`).

The launcher starts Claude with `--permission-mode auto` in interactive and headless modes. This removes the need to toggle auto mode manually while retaining Claude's permission policy; it does not use `bypassPermissions`.

**Background/inspectable auto-launch (`mode: "autonomous"` or `--autonomous`):** prefers tmux/screen detached PTY, then macOS Terminal.app `do script` **without** `activate`, then Linux/Windows emulators. Soft-falls back to `--paste-only` when spawn is unavailable. Soft-fails with tip + exit 0 when `claude` is missing (Field Report owed). Never runs silent `claude -p` in a chat agent shell. Rollback to OS window focus: `--focus-terminal` or `AGENT_KIT_AUDIT_FOCUS_TERMINAL=1`. ADR: `.cursor/memory/decisions/2026-07-28_audits-headless-terminal-honesty.md`.

**Post-spawn monitor watch (`--wait-monitor`):** chat autonomous arms **must** pass `--force --autonomous --wait-monitor`. The launcher records an arm epoch, then polls until `.cursor/memory/plan-monitor-<slug>.md` is **fresh** (`mtime >= arm epoch`, or a content sentinel line `<!-- audits-wait-fresh: created -->` / `updated`), or until `--wait-timeout` (default 900s). Pre-arm files are ignored (existence alone is not ready). Exit codes: `0` fresh ready (soft-fail tip + exit 0 only when wait is off), `3` timeout, `4` soft-fail while waiting. Dry-run prints wait path, timeout, arm-epoch, and stale/missing status. Spawn-only exit 0 without wait is not review done. Exit `3` is **timeout only**: it never means review done, and a monitor written afterwards by a later or separate arm does not convert it into success (leave the target Field Report owed and re-arm). ADRs: `.cursor/memory/decisions/2026-07-27_audits-wait-freshness-enforce.md`, `.cursor/memory/decisions/2026-07-27_audits-post-spawn-monitor-watch-continue.md`.

**Post-spawn progress gate:** a successful spawn is a launch, not a running review. After an autonomous background spawn on a channel that exposes scrollback (tmux `capture-pane`, screen `hardcopy`), the launcher waits briefly for its own pre-exec banner to land, measures that banner as a baseline, then polls every 2 seconds for scrollback growth *beyond* the banner before entering the monitor wait. Default grace window is 60s, overridable with `AGENT_KIT_AUDIT_PROGRESS_TIMEOUT` (`0` disables the gate; a non-integer value prints a tip and falls back to 60). Channels without a scrollback API (Terminal.app, Linux/Windows emulators) degrade to advisory (`progress gate skipped`) and proceed to the normal wait; the gate never aborts a channel it cannot sample. A silent PTY (no growth beyond the banner, or a session that vanished before producing output) is reported as a failed launch: the launcher disposes only the session it just spawned, prints the paste fallback, and soft-fails (exit `4` with `--wait-monitor`, tip + exit `0` otherwise) instead of burning the remaining `--wait-timeout`. No new exit code. Dry-run prints `progress-gate`, `progress-timeout`, and a note that the channel is resolved at spawn time. ADR: `.cursor/memory/decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md`.

**Audit-session cap and dispose policy:** kit-owned audit sessions are named `agent-kit-audit-<ws8>-<pid>`, where `<ws8>` is an 8-hex workspace token derived from the repository root. Cap, warn, count, and opt-in reap only consider sessions owned by **this** workspace (strict pattern `agent-kit-audit-<8hex>-<digits>` matching the local token). Legacy unscoped `agent-kit-audit-<pid>` names and other workspaces' tokens are never counted or disposed by this process (quit them manually if needed). Before an autonomous spawn the launcher counts existing **detached** workspace-owned sessions; attached sessions are operator work in progress and are never counted as pressure or touched by any flag. At or above the warn threshold (`AGENT_KIT_AUDIT_SESSION_WARN`, default 5, `0` disables) the launcher prints the count plus the dispose command and continues. At or above the hard cap (`AGENT_KIT_AUDIT_SESSION_CAP`, default 20, `0` disables) it **refuses to spawn**: it prints the count, the cap, the dispose instructions, and the paste fallback, then soft-fails (exit `4` with `--wait-monitor`, tip + exit `0` otherwise). A refusal never spawns and never enters the monitor wait, so no audit starts and the Field Report stays owed. Detached is the normal steady state of a healthy autonomous arm, so warn/cap measure concurrency, not staleness; use `--reap-audit-sessions` for opt-in cleanup of sessions past the age floor. Reaping is opt-in via `--reap-audit-sessions` or `AGENT_KIT_AUDIT_REAP=1`: it disposes only detached workspace-owned sessions whose age is at or above `AGENT_KIT_AUDIT_REAP_MIN_AGE` (default 3600 seconds) and prints one line per disposal and per skip (attached, too young, age unknown, not owned). An age that cannot be determined counts as too young, so the safe default is to keep the session. Age comes from the multiplexer (screen socket mtime, tmux `session_created`), so a session with recent multiplexer activity can read younger than its wall-clock start; the bias is always toward keeping sessions alive. `--dry-run` previews the reap without killing anything and adds `audit-sessions: N detached owned (warn: X, cap: Y)`, `audit-workspace-token`, `audit-session-prefix`, `reap: yes|no (min-age: Zs; owned prefix only)`, and the resulting gate verdict to the dry-run report. A non-integer value for any of the three thresholds prints a tip and falls back to the default. The post-spawn progress gate above stays responsible for disposing the single session a run just spawned; this policy covers the pile left by earlier arms. No new exit code, and the CI/headless `--print` path is unaffected. ADR: `.cursor/memory/decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md`.

**Mid-batch consume:** with `midBatchAudits: true`, arm **one** background `--wait-monitor` per plan (or one `--batch` + wait_all). Do not fan out N sessions without wait. Mid-queue skips triage Ask; queue-end triage uses an explicit path list of fresh monitors.

**Smoke / dry-run:**

```bash
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor --dry-run my-plan.plan.md
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor --batch --dry-run a.plan.md b.plan.md
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor --wait-timeout 900 --dry-run my-plan.plan.md
.cursor/scripts/plan-external-review.sh --wait-monitor --wait-timeout 5 --dry-run my-plan.plan.md
bash -n .cursor/scripts/plan-external-review.sh
AGENT_KIT_AUDIT_SESSION_CAP=1 .cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor --dry-run my-plan.plan.md
.cursor/scripts/plan-external-review.sh --reap-audit-sessions --dry-run
# Stale pre-arm file → exit 3; touch/rewrite after arm or add freshness sentinel → exit 0
```

```bash
# Chat / session autonomous (mandatory wait + freshness)
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor

# Spawn then wait for a fresh plan-monitor-<slug>.md
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor [--wait-timeout 900]

# Poll-only (already-running review; still requires freshness after arm epoch)
.cursor/scripts/plan-external-review.sh --wait-monitor [--wait-timeout 900] my-plan.plan.md

# Mid-batch or queue-end batch arm (one wait_all)
.cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor --batch plan-a.plan.md plan-b.plan.md

# Legacy paste fallback: clipboard + print (does not start Claude)
.cursor/scripts/plan-external-review.sh --force --paste-only

# Then paste in YOUR Cursor terminal (script prints/copies this):
.cursor/scripts/plan-external-review.sh --force --interactive my-plan.plan.md

# CI / headless: bypass enabled check, claude -p (no IDE panel)
.cursor/scripts/plan-external-review.sh --force --print

# Interactive Claude session (already in Cursor terminal)
.cursor/scripts/plan-external-review.sh --interactive

# Explicit plan file
.cursor/scripts/plan-external-review.sh my-plan.plan.md
```

## Best practices

### When to use

- **After plan completion:** All implementable to-dos are done
- **Before major releases:** Validate shipped scope matches original requirements
- **Quality gates:** Ensure implementation meets acceptance criteria
- **Handoff preparation:** Document gaps before transitioning to maintenance

### When to skip

- **Mid-execution:** External review only works on completed work
- **Time-sensitive deploys:** Optional feature; can run later
- **Simple plans:** Single-feature plans may not need external validation

### Triage guidelines

**Choose "Fix nits only" for:**

- Documentation typos or formatting
- Missing obvious validations
- Small configuration tweaks
- Clear oversights that take under 30 minutes

**Choose "Write residuals plan" for:**

- Missing features from original scope
- Performance or security concerns
- Architecture improvements
- Multi-file refactoring needs

**Choose "Ack and stop" for:**

- Known limitations (documented decisions)
- Future enhancements (not current scope)
- Suggestions that do not align with project priorities

## Integration points

- **HANDOFF updates:** External review results update `.cursor/HANDOFF.md`
- **Git staging:** Monitor files and fixes stage via `/git-staging` (never `/git-prod`)
- **Memory system:** Significant findings enter `.cursor/memory/` for future reference
- **Plan creation:** Residuals enqueue via the `/backlog-add` contract from `/plan-review-triage` (Broad Intake + write-confirm Ask → plan file + HANDOFF Backlog; no Gate B). Clipboard `/start-project` is not the happy path; use `/start-project` only when activate + Gate B is wanted.

## Troubleshooting

**Continuation dual-fence (autonomous launch, manual resume):**

- Symptom: autonomous (background PTY) audit armed, chat stops at "watch that session" / waits for typed `done`, triage never starts until a human re-prompts.
- Fix: chat arm with `--force --autonomous --wait-monitor`, AwaitShell until exit `0|3|4`, then on `0` run `/plan-review-triage` Ask in the same session. Do not invent a finished review on timeout/soft-fail. Do not defer via Final HANDOFF "after monitor lands".
- Dogfood: `.cursor/memory/errors/2026-07-27_audits-autonomous-launch-manual-done-continuation.md`. ADR: `decisions/2026-07-27_audits-post-spawn-monitor-watch-continue.md`.

**Stale pre-arm monitor false-ready:**

- Symptom: `--wait-monitor` prints `wait-monitor created` in seconds because `plan-monitor-<slug>.md` already existed; orchestrator skips triage Ask or continues as if a new review finished.
- Fix: launcher freshness gate (`mtime >= arm epoch` or `<!-- audits-wait-fresh: created|updated -->`). Chat L0 always passes `--wait-monitor` on autonomous arm; exit `0` is required before triage Ask. Mid-batch: one arm+wait (or one `--batch` + wait_all), no unwatched multi-Terminal fan-out.
- Dogfood: `.cursor/memory/errors/2026-07-27_audits-wait-monitor-stale-preexisting.md`. ADR: `decisions/2026-07-27_audits-wait-freshness-enforce.md`.

**Silent PTY: spawn succeeded, empty scrollback:**

- Symptom: the launcher prints `background terminal launched`, the session stays detached with a 0-byte hardcopy, no monitor is ever written, and `--wait-monitor` burns its full budget to exit `3`.
- Fix: the post-spawn progress gate samples scrollback for 60s (`AGENT_KIT_AUDIT_PROGRESS_TIMEOUT`) and aborts early on silence. It measures the launcher banner first, then requires scrollback growth beyond that banner, so a launch that only prints the pre-exec banner (no Claude output) is still caught. Sampling counts non-whitespace bytes and targets window 0 explicitly (`screen -S <name> -p 0 -X hardcopy`), because a detached session writes a padded blank buffer, or nothing at all, when no window is targeted. Read the diagnosis, keep the Field Report owed, and re-arm with the printed paste fallback or attach the channel manually. Exit `3` is timeout-only and is never review done; monitors written later by another arm do not convert it into success.
- ADR: `.cursor/memory/decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md`.

**Accumulated detached audit sessions:**

- Symptom: repeated autonomous arms leave `agent-kit-audit-<ws8>-<pid>` sessions detached (each one a PTY that never produced a monitor), and later arms keep adding to the pile.
- Policy (preventive, not cleanup of a known pile): the launcher counts detached **workspace-owned** sessions before every autonomous spawn, warns at or above `AGENT_KIT_AUDIT_SESSION_WARN` (default 5), and refuses to spawn at or above `AGENT_KIT_AUDIT_SESSION_CAP` (default 20) instead of adding one more. Attached sessions are operator work in progress and are never counted or disposed. Foreign-workspace and legacy unscoped `agent-kit-audit-<pid>` names are out of scope for cap/reap.
- Backlog: a liveness probe that checks whether each counted detached session is still alive (multiplexer session present and/or scrollback growing) before refusing at the cap would distinguish healthy concurrent arms from a zombie pile. The current count is by session name only, so a host running many genuine concurrent reviews still triggers the cap and must use `--reap-audit-sessions` or raise the cap to continue.
- Inspect: `screen -ls` (or `tmux ls`).
- Dispose (opt-in, detached kit-owned sessions past the age floor only):

```bash
.cursor/scripts/plan-external-review.sh --reap-audit-sessions --dry-run                    # preview, kills nothing
.cursor/scripts/plan-external-review.sh --reap-audit-sessions                              # pure disposal, no audit starts
.cursor/scripts/plan-external-review.sh --reap-audit-sessions --force --autonomous <plan>   # reap then launch a new audit
AGENT_KIT_AUDIT_REAP_MIN_AGE=0 .cursor/scripts/plan-external-review.sh --reap-audit-sessions --dry-run
```

- Manual, one session at a time: `screen -S <session-name> -X quit` or `tmux kill-session -t <session-name>`. Never a wildcard kill or `pkill` on the namespace.
- ADR: `.cursor/memory/decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md`.

**Claude CLI not found:**

- External review skips with a tip message and exit 0 (exit 4 when `--wait-monitor` was requested)
- Plan execution continues normally
- Manual review remains available when Claude is installed later

**Review disabled:**

- Missing config or `enabled: false` defaults to no auto-arm
- Exhaustion Ask may still offer Run now / Always / Not now when `offerOnExhausted` allows it
- `/plan-external-review` documents setup steps

**Permission issues:**

- Monitor files require write access to `.cursor/memory/`
- Review script needs read access to plan and HANDOFF files
- Git operations follow standard staging flow permissions

## Implementation notes

- **Not a native Cursor hook:** Avoids interfering with HITL confirmation prompts
- **Evidence-based:** Claude reviews actual git history and deliverables
- **Findings-only review workers:** Claude and Cursor review ticks write monitors/findings; they do not auto-fix product code. `/run-plan` enforces `externalPlanReview.autoRemediate` (default false) as the remediation gate (fix agent vs residuals plan). The launcher injects the current `autoRemediate` value into the Claude prompt.
- **Staging-first:** All fixes follow standard `/git-staging` → `/git-prod` flow
- **Opt-in default:** Requires explicit configuration (or Always / onboard Enable) to auto-arm
- **Human gate:** Triage step prevents automatic implementation of suggestions from external monitors
