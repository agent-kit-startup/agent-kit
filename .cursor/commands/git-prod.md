---
name: git-prod
description: Promote origin/staging to origin/main following the git prod routine (HITL confirmation required).
---

# Git prod

Follow the **git prod** routine to promote `origin/staging` to `origin/main` (production):

Factory landing wrap (not consumer L0): `/kit-prod` when that file exists. This command stays git-only.

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

1. **Read** the "Prompt: git prod" section in `autogit/gitupdate.md` (when it exists in the project).
2. Critical validation: no uncommitted local changes; never commit directly to main.
3. Close the release in the CHANGELOG (move `[Unreleased]` to a dated version) before merging. Keep `<!-- changelog-private -->` fences when the project uses them.
4. Show a summary of the changes (diff/log) between staging and main and **ask for explicit confirmation using Ask questions tool** before merging and pushing to main.
   
   Options: `Proceed with production deploy` / `Review changes first` / `Cancel`
   
   **Advisory (does not replace confirmation):** if Blocking untriaged `.cursor/memory/plan-monitor-*.md` match themes in the staging→main delta, mention them once in the summary. Never steal this Ask; Field Report / `/plan-review-triage` stay attention/HITL SoT.
   
   **Fallback (path 1):** if Ask questions is missing, say so once, print the same three labels as a numbered list, accept number or label, and treat a typed answer as Other. Do not invent a fake tool call.
5. **Agent signature gate (hard stop, before merge to main):** after the confirmation and before any merge or push, scan everything that would reach `main`: `git log origin/main..origin/staging --format=%B | sh git-hooks/prepare-commit-msg --check -`.
   When the promotion goes through a staging→main PR (the Claude CLI lane in `autogit/gitupdate.md`), also scan its body before merge: `gh pr view <N> --json body -q .body | sh git-hooks/prepare-commit-msg --check -`.
   Exit 0 prints `ok`. Exit 1 lists the offending lines: **stop**; the fix lands on `staging` through `/git-staging` (reword the commit on a working branch, or `gh pr edit <N> --body`), then re-run this step from the top. Exit 2 (missing hook file, grep failure) is red, not a pass. Never merge, push, or tag over a red scan. Same shape as the Evidence-checks gate in `/git-staging`; pattern list: `sh git-hooks/prepare-commit-msg --list`. ADR: `2026-09-11_agent-signature-guard-strip-hook-check-gate`.
6. **One confirm, one ship:** `Proceed with production deploy` authorizes exactly one SemVer close, one annotated `v*` tag, and one promote. A red or unfinished post-prod verification (step 11) is a STOP; it does not authorize another patch under the same yes. Next ship needs a new Ask.
   `/run-plan-all` only: when HANDOFF `- **Ship auth:**` is `per-plan-release`, skip step 4. That queue confirm is this plan's yes. Still one tag. A red post-prod verification stops the queue.
7. Run merge to main (`git merge --no-ff` when promoting locally; real merge preferred on the staging→main PR path). Prepare local main (merge and signature scan green) before any push.

   **Claude Code lane (or a recorded classifier denial of this push):** Do not run `ALLOW_MAIN_PUSH=1 git push origin main`. Ask with these exact labels:

   - `I pushed main`
   - `Open staging→main PR instead`
   - `Cancel`

   **On `I pushed main`:** The operator already pushed. Verify `origin/main` advanced, then continue with the annotated tag, staging sync, and the report. Do not run the push.
   **On `Open staging→main PR instead`:** While on local `main`, `git reset --hard origin/main`, then `gh pr create --base main --head staging`. Prefer a merge commit. Wait for the operator to merge the PR.
   **On `Cancel`:** Stop. Do not tag, push, or open a PR.

   **Other lanes:** Push with the authorized inline form `ALLOW_MAIN_PUSH=1 git push origin main`, then continue with the annotated tag. Bare `git push origin main` stays denied by `agent-kit guard shell` and `git-hooks/pre-push`. Do not export `ALLOW_MAIN_PUSH=1` as a session environment variable. Do not add `--force`, `--no-verify`, or a non-main destination.

   Details: `autogit/gitupdate.md` Prompt git prod step 9.
8. **Sync staging (mandatory):** immediately after `main` is pushed, if `git merge-base --is-ancestor origin/staging origin/main`, fast-forward staging with `git merge --ff-only origin/main` and push. Do not open a merge PR that only records `origin/main` as ancestor. If staging is not an ancestor, stop and report; do not back-merge in this prod session. Details: `autogit/gitupdate.md` step 10.
9. Update `.cursor/HANDOFF.md` ("promoted to production") and memory-loop WRITE if it applies.
10. Annotated `v*` tags trigger whatever tag CI the project configures.
11. **Post-prod verification (mandatory):** before ending, report `autogit/gitupdate.md` step 12. If the project defines post-prod release verification (e.g. a factory wrapper command), run it; otherwise **Done** = `origin/main` pushed, tag pushed, tag CI green, all on the same `vX.Y.Z`. Red or unfinished is a **STOP** (no next patch under this yes).
12. **Close-release / tags:** bump every version manifest the project keeps (in a consumer project `.cursor/agent-kit.json` records the installed kit, not a product manifest; a wrapper command may list extra manifests); never force-move an already-pushed `v*` tag. Release-close stays its own PR to staging (do not bundle with a main-back-merge or product fix). Retry via a new **patch** tag when the fix must republish (**new** `/git-prod` confirm); **hold** (manifests stay on the tagged SemVer, no new tag) when the existing tarball is enough; local-only recreate before first push. Same rule as `autogit/gitupdate.md` SemVer / step 9.5.
