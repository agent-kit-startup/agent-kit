# External Plan Review

Optional post-completion review of shipped work against the original plan using Claude Code CLI. When a plan finishes all implementable to-dos, get evidence-based gap detection from a second agent without interfering with the original execution flow.

L0 ships the commands, templates, launcher, and `config.example.json` with the base install. The feature stays **opt-in** (`enabled: false` by default). Claude Code is never required for install or CI; a missing `claude` binary or missing prompt template yields a tip and exit 0.

**Install note:** session L3 protection covers `config.json`, `current/**`, and `backups/**` only. If an older manifest still lists `.cursor/context/**`, `agent-kit update` expands that glob so templates can install. If the prompt file is missing after a fresh offer, run `agent-kit update --refresh` and re-arm.

## Setup

1. **Enable configuration** (or accept Enable during `/onboard` External Review Ask):
   ```json
   // .cursor/context/config.json
   {
     "externalPlanReview": {
       "enabled": true,
       "backend": "claude",
       "autoRemediate": false,
       "offerOnExhausted": true
     }
   }
   ```

2. **Install Claude Code CLI** (optional): Follow Claude's installation guide so `claude` is on PATH when you want auto-arm or headless review.

## Workflow

### 1. Run plan to completion

Use `/run-plan` or manual `/continue-plan` until all implementable to-dos are completed.

### 2. External review triggers

**Automatic (when enabled):** When `/run-plan` reaches plan exhausted, the kit arms the canonical launcher:

```bash
.cursor/scripts/plan-external-review.sh
```

A thin wrapper at `scripts/plan-external-review.sh` remains for dogfood and older docs; prefer `.cursor/scripts/`.

**Exhaustion Ask (when not yet enabled):** If `enabled` is false and `offerOnExhausted` is not false, chat `/run-plan` may Ask once-style:

- `Run review now` (one-shot via `--force`, no persist)
- `Always enable automatic` (sets `enabled: true`, then arms)
- `Not now` (sets `offerOnExhausted: false`; manual command still works)

Onboard also offers a light Ask after workspace skin: `Enable Claude external review` / `Skip for now`.

**Manual:** Use `/plan-external-review` anytime after completion.

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

### 4. Triage findings

Use `/plan-review-triage` to process the monitor with clickable options:

- **Write residuals plan:** Create a new plan for significant gaps or improvements
- **Fix nits only:** Address small issues directly (typos, formatting, obvious omissions)
- **Ack and stop:** Note findings for future reference without immediate action

## Configuration options

```json
// .cursor/context/config.json
{
  "externalPlanReview": {
    "enabled": false,
    "backend": "claude",
    "autoRemediate": false,
    "offerOnExhausted": true
  }
}
```

| Field | Meaning |
|-------|---------|
| `enabled` | Auto-arm on plan exhaustion (default: false) |
| `backend` | External agent type (default: `"claude"`) |
| `autoRemediate` | Apply fixes automatically (default: false; triage always required) |
| `offerOnExhausted` | When `enabled` is false, allow exhaustion Ask until Always or Not now (default: true) |

## Script options

Canonical launcher: `.cursor/scripts/plan-external-review.sh` (wrapper: `scripts/plan-external-review.sh`).

```bash
# Default: non-interactive claude -p
.cursor/scripts/plan-external-review.sh

# Interactive Claude session
.cursor/scripts/plan-external-review.sh --interactive

# Print prompt for copy-paste
.cursor/scripts/plan-external-review.sh --paste-only

# One-shot: bypass enabled check without persisting opt-in
.cursor/scripts/plan-external-review.sh --force

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
- **Plan creation:** Residuals flow through standard `/start-project` gates

## Troubleshooting

**Claude CLI not found:**

- External review skips with a tip message and exit 0
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
- **Staging-first:** All fixes follow standard `/git-staging` → `/git-prod` flow
- **Opt-in default:** Requires explicit configuration (or Always / onboard Enable) to auto-arm
- **Human gate:** Triage step prevents automatic implementation of suggestions
