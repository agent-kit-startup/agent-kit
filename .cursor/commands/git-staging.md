---
name: git-staging
description: Bring local changes to the pre-production branch following the git staging routine.
---

# Git staging

Follow the **git staging** routine to bring local changes to the pre-production branch (`origin/staging` in this repo, or the name configured for the project).

Factory landing wrap (not consumer L0): `/kit-staging` when that file exists. This command stays git-only.

**Auth-block hard stop:** After a successful SSH push, if `gh pr create` / `glab mr create` returns HTTP 401 (or another auth failure), print the compare/create URL and await. Stay on this command. Do not invent product (dotenv, L0, CHANGELOG, overlay hashes, hard-rules). Do not load `.env` as a GitHub token source. Details: Prompt git staging §9.

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

1. **Read** the "Prompt: git staging" section in `autogit/gitupdate.md` (when it exists).
2. **Staging hygiene (monitors):** if `git status` shows untracked or unrelated dirty `.cursor/memory/plan-monitor-*.md`, **warn** before commit. Stage memory/monitor files **add-by-name only**; never broad `git add` of `.cursor/memory/` WIP into a product commit (ADR `decisions/2026-07-27_plan-monitor-consumer-awareness.md`, external-review staging hygiene). Warn/add-by-name forbids sweeps; it does **not** mean leave soft kit artifacts dirty. Inventory remaining safe dirt into a `docs(memory):` / `chore(kit):` bucket and ship it in this run (SoT: `autogit/gitupdate.md` Prompt git staging §1 and §7). Do not stop-and-quiz solely because a path looks out of the current flow.
3. **Lint evidence (required when code/format paths change):** before claiming staging-ready, **run** the repo formatter/linter on touched files and **record the command + result** (pass/fail) in the worker summary or tick notes. Writing `Staging ready: yes` or the contract string alone is **not** evidence. Pure markdown / docs-only with no applicable linter: state `none applicable`. Same gate as `/run-plan` Staging-ready lint gate.
   **Dashboard CSS/HTML only** (`dashboard/dashboard.html` and similar, outside Biome scope): record `Tests: none applicable (dashboard-CSS); covered by plugin-ux-validation` when the UX suite pins the change (ADR `decisions/2026-07-29_dashboard-css-lint-evidence-convention.md`); do not claim Biome covered the HTML.
4. Run in order: validation (not on `main`), CHANGELOG (`[Unreleased]`), checkout staging, pull, working branch, Conventional Commits, push, MR/PR (**always `--base staging` / target `staging`**), merge, cleanup.
5. **Agent signature gate (hard stop, before push and before merge):** scan the outgoing commit messages and the PR body against the agent-signature / session-link pattern list embedded in `git-hooks/prepare-commit-msg` (`Co-Authored-By: Claude ...`, `Claude-Session:`, Cursor / Copilot / Codex / Devin trailers, `Generated with <agent>` lines, agent session URLs; `--list` prints it). Same shape as the Evidence-checks gate below: run, read the exit code, never merge over red.
   - Before `git push`: `git log origin/staging..HEAD --format=%B | sh git-hooks/prepare-commit-msg --check -`
   - After `gh pr create`, before `gh pr merge`: `gh pr view <N> --json body -q .body | sh git-hooks/prepare-commit-msg --check -`
   Exit 0 prints `ok`. Exit 1 lists the offending lines with line numbers: **stop**, remove them (`git commit --amend` or `git rebase -i` on the working branch, `gh pr edit <N> --body` for the PR body), push again and re-run the scan. Exit 2 is a usage error (missing hook file, grep failure), not a pass: treat it as red. Do not route around a red scan with `--no-verify`, a hand-typed "ok", or a merge from the GitHub UI. A squash merge folds every branch commit message into the staging commit, so a trailer left on any branch commit reaches `staging` and later `main`; that is what the pre-push scan catches. ADR: `2026-09-11_agent-signature-guard-strip-hook-check-gate`.
6. **Evidence-checks gate (before merge / Gaps-none):** run `gh pr checks <N>` and confirm `build` (including the **Evidence checks** step) is green. If Evidence checks fail, regenerate and re-push before merge; do not write HANDOFF `- **Gaps:** none` over red. ADR: `2026-08-01_evidence-checks-merge-gate`.
7. **Never** commit directly to `main`.
8. On completion: update `.cursor/HANDOFF.md` (phase in staging); memory-loop WRITE if it applies.
9. Optional: update the project's PM tool (ClickUp, Jira, ...) if MCP is configured.
