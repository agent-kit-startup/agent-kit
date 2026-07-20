# External Plan Review

Optional post-completion review of shipped work against the original plan using Claude Code CLI. When a plan finishes all implementable to-dos, get evidence-based gap detection from a second agent without interfering with the original execution flow.

## Setup

1. **Enable configuration:**
   ```json
   // .cursor/context/config.json
   {
     "externalPlanReview": {
       "enabled": true
     }
   }
   ```

2. **Install Claude Code CLI:** Follow Claude's installation guide to get `claude` command on your PATH.

## Workflow

### 1. Run plan to completion

Use `/run-plan` or manual `/continue-plan` until all implementable to-dos are completed:

```
✅ api-auth-setup
✅ user-registration  
✅ password-validation
⏸️ external-sso-integration (blocked: waiting for provider keys)
```

### 2. External review triggers

**Automatic (recommended):** When `/run-plan` reaches plan exhausted, it suggests:
```bash
scripts/plan-external-review.sh
```

**Manual:** Use `/plan-external-review` command anytime after completion.

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
    "enabled": true,
    "backend": "claude",
    "autoRemediate": false
  }
}
```

- `enabled`: Opt-in flag (default: false)
- `backend`: External agent type (default: "claude")
- `autoRemediate`: Whether to apply fixes automatically (default: false, always requires triage)

## Script options

```bash
# Default: non-interactive claude -p
scripts/plan-external-review.sh

# Interactive Claude session  
scripts/plan-external-review.sh --interactive

# Print prompt for copy-paste
scripts/plan-external-review.sh --paste-only

# Explicit plan file
scripts/plan-external-review.sh my-plan.plan.md
```

## Best practices

### When to use

- **After plan completion:** All implementable to-dos are done
- **Before major releases:** Validate shipped scope matches original requirements
- **Quality gates:** Ensure implementation meets acceptance criteria
- **Handoff preparation:** Document gaps before transitioning to maintenance

### When to skip

- **Mid-execution:** External review only works on completed work
- **Time-sensitive deploys:** Optional feature, can be used later
- **Simple plans:** Single-feature plans may not need external validation

### Triage guidelines

**Choose "Fix nits only" for:**
- Documentation typos or formatting
- Missing obvious validations
- Small configuration tweaks
- Clear oversights that take < 30 minutes

**Choose "Write residuals plan" for:**
- Missing features from original scope  
- Performance or security concerns
- Architecture improvements
- Multi-file refactoring needs

**Choose "Ack and stop" for:**
- Known limitations (documented decisions)
- Future enhancements (not current scope)
- Suggestions that don't align with project priorities

## Integration points

- **HANDOFF updates:** External review results update `.cursor/HANDOFF.md`
- **Git staging:** Monitor files and fixes stage via `/git-staging` (never `/git-prod`)
- **Memory system:** Significant findings enter `.cursor/memory/` for future reference
- **Plan creation:** Residuals flow through standard `/start-project` gates

## Troubleshooting

**Claude CLI not found:**
- External review skips with tip message
- Plan execution continues normally
- Manual review remains available

**Review disabled:**
- Missing config file defaults to disabled
- `/plan-external-review` command documents setup steps
- No automatic suggestions from `/run-plan`

**Permission issues:**
- Monitor files require write access to `.cursor/memory/`
- Review script needs read access to plan and HANDOFF files
- Git operations follow standard staging flow permissions

## Implementation notes

- **Not a native Cursor hook:** Avoids interfering with HITL confirmation prompts
- **Evidence-based:** Claude reviews actual git history and deliverables
- **Staging-first:** All fixes follow standard `/git-staging` → `/git-prod` flow
- **Opt-in default:** Requires explicit configuration to activate
- **Human gate:** Triage step prevents automatic implementation of suggestions