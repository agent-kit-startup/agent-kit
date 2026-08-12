---
name: git-staging
description: Bring local changes to the pre-production branch following the git staging routine.
---

# Git staging

Follow the **git staging** routine to bring local changes to the pre-production branch (`origin/staging` in this repo, or the name configured for the project).

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

1. **Read** the "Prompt: git staging" section in `autogit/gitupdate.md` (when it exists).
2. **Staging hygiene (monitors):** if `git status` shows untracked or unrelated dirty `.cursor/memory/plan-monitor-*.md`, **warn** before commit. Stage memory/monitor files **add-by-name only**; never broad `git add` of `.cursor/memory/` WIP into a product commit (ADR `decisions/2026-07-27_plan-monitor-consumer-awareness.md`, external-review staging hygiene).
3. **Lint evidence (required when code/format paths change):** before claiming staging-ready, **run** the repo formatter/linter on touched files and **record the command + result** (pass/fail) in the worker summary or tick notes. Writing `Staging ready: yes` or the contract string alone is **not** evidence. Pure markdown / docs-only with no applicable linter: state `none applicable`. Same gate as `/run-plan` Staging-ready lint gate. **Dashboard CSS/HTML only** (`dashboard/dashboard.html` and similar, outside Biome scope): record `Tests: none applicable (dashboard-CSS); covered by plugin-ux-validation` when the UX suite pins the change (ADR `decisions/2026-07-29_dashboard-css-lint-evidence-convention.md`); do not claim Biome covered the HTML.
4. Run in order: validation (not on `main`), CHANGELOG (`[Unreleased]`), checkout staging, pull, working branch, Conventional Commits, push, MR/PR (**always `--base staging` / target `staging`**), merge, cleanup.
5. **Evidence-checks gate (before merge / Gaps-none):** run `gh pr checks <N>` and confirm `build` (including the **Evidence checks** step) is green. If Evidence checks fail, regenerate and re-push before merge; do not write HANDOFF `- **Gaps:** none` over red. ADR: `2026-08-01_evidence-checks-merge-gate`.
6. **Never** commit directly to `main`.
7. On completion: update `.cursor/HANDOFF.md` (phase in staging); memory-loop WRITE if it applies.
8. Optional: update the project's PM tool (ClickUp, Jira, ...) if MCP is configured.
