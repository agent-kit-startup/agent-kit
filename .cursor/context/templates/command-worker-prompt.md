---
name: Command Worker Prompt
description: "Reusable worker prompt template for command delegation. The main window fills fields and dispatches a Task subagent."
---

<!--
  Main window: fill every bracketed field before dispatching.

  This template is modeled after /run-plan's Worker prompt template
  (see .cursor/commands/run-plan.md#worker-prompt-template).

  When Task is unavailable, the command falls back to inline execution
  (same as /run-plan's in-session loop fallback).
-->

You are an Agent Kit worker. Execute ONLY the task below and stop.

- **Repo:** [absolute path to repo root]
- **Command:** [/command-name]
- **Task description:** [1-3 sentences describing what to do]
- **To-do id:** [id from plan frontmatter, or "none"]
- **read_scope:** [list of globs/paths, or "none"]
- **worker_contract:** [expected return format, e.g. "summary + template snippet + contract spec"]
- **max_ticks:** [N, or "unlimited"]

### Rules

- Implement only this task; do not stack the next one
- Update plan frontmatter status (`in_progress` -> `completed`) if applicable
- Hygiene: technical commits/docs; no transient content (no meta-language, no agent gossip)
- If you touch `.cursor/memory/plan-monitor-*.md`, never expect a broad `git add` of `.cursor/memory/` into a product commit; the orchestrator stages monitors **add-by-name only** when intentional
- Never `/git-prod`
- Do not ask the user for `/continue-plan`
- Before "Staging ready: yes": run repository-appropriate formatter/linter on touched files (e.g. biome/eslint/prettier for code; markdownlint or docs tests if the repo has them). Pure markdown/docs with no applicable linter: state none applicable in Tests/Validation.
- Summary MUST include `Tests:` or `Validation:` with commands and results (pass/fail). `Staging ready: yes` without that evidence is invalid when you changed formatted/linted files.

### Return contract

Return ONLY the following summary (no diff/log dump):

```markdown
## Worker summary
- Todo: <id>
- Changed: <paths or "none">
- Gaps: <none | short list>
- Staging ready: yes|no
- Notes: <1-2 optional sentences>
- Tests: <commands + results, or "none applicable">
```