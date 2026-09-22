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
3. Close the release in the CHANGELOG (move `[Unreleased]` to a dated version) before merging. Keep `<!-- changelog-private -->` fences. Public excerpt: `node scripts/public-changelog.mjs --version <X.Y.Z>` (GitHub Release body) and `--blurb` (landing `--notes`).
4. Show a summary of the changes (diff/log) between staging and main and **ask for explicit confirmation using Ask questions tool** before merging and pushing to main.
   
   Options: `Proceed with production deploy` / `Review changes first` / `Cancel`
   
   **Advisory (does not replace confirmation):** if Blocking untriaged `.cursor/memory/plan-monitor-*.md` match themes in the staging→main delta, mention them once in the summary. Never steal this Ask; Field Report / `/plan-review-triage` stay attention/HITL SoT.
   
   **Fallback (path 1):** if Ask questions is missing, say so once, print the same three labels as a numbered list, accept number or label, and treat a typed answer as Other. Do not invent a fake tool call.
5. **Agent signature gate (hard stop, before merge to main):** after the confirmation and before any merge or push, scan everything that would reach `main`: `git log origin/main..origin/staging --format=%B | sh git-hooks/prepare-commit-msg --check -`.
   When the promotion goes through a staging→main PR (the Claude CLI lane in `autogit/gitupdate.md`), also scan its body before merge: `gh pr view <N> --json body -q .body | sh git-hooks/prepare-commit-msg --check -`.
   Exit 0 prints `ok`. Exit 1 lists the offending lines: **stop**; the fix lands on `staging` through `/git-staging` (reword the commit on a working branch, or `gh pr edit <N> --body`), then re-run this step from the top. Exit 2 (missing hook file, grep failure) is red, not a pass. Never merge, push, or tag over a red scan. Same shape as the Evidence-checks gate in `/git-staging`; pattern list: `sh git-hooks/prepare-commit-msg --list`. ADR: `2026-09-11_agent-signature-guard-strip-hook-check-gate`.
6. **One confirm, one ship:** `Proceed with production deploy` authorizes exactly one SemVer close, one annotated `v*` tag, and one promote. A red or stale public sync (step 12.5) is a STOP; it does not authorize another patch under the same yes. Next ship needs a new Ask.
7. Run merge to main (`git merge --no-ff` when promoting locally; real merge preferred on the staging→main PR path), then push with the authorized inline form only:

   `ALLOW_MAIN_PUSH=1 git push origin main`

   Bare `git push origin main` stays denied by `agent-kit guard shell` and `git-hooks/pre-push`. Do not export `ALLOW_MAIN_PUSH=1` as a session environment variable. Do not add `--force`, `--no-verify`, or a non-main destination. Then create/push annotated vX.Y.Z tag (when absent) and confirm production. Details: `autogit/gitupdate.md` Prompt git prod step 9.
8. **Sync staging (mandatory):** immediately after `main` is pushed, if `git merge-base --is-ancestor origin/staging origin/main`, fast-forward staging with `git merge --ff-only origin/main` and push. Do not open a merge PR that only records `origin/main` as ancestor. If staging is not an ancestor, stop and report; do not back-merge in this prod session. Details: `autogit/gitupdate.md` step 10.
9. Update `.cursor/HANDOFF.md` ("promoted to production") and memory-loop WRITE if it applies.
10. In this monorepo: annotated tags trigger `publish-npm` + `sync-public` CI; `pnpm git:trigger-public-sync` fallback when needed per `autogit/gitupdate.md`.
11. **Post-prod verification (mandatory in this monorepo):** before ending, report step 12.5. **Done** for this promote: private `main`, `npm view @dadado/agent-kit-cli version`, the merged public sync PR, and public GitHub Release Latest all name the same `vX.Y.Z`. The run is unfinished until they agree. Private tag CI must show `build`, `publish-npm`, `sync-public`, and `sync-landing` green; a red `sync-landing` is a STOP (fail-closed). Silent npm success with a stale public Releases badge, or CI-green with an unmerged sync PR, is a kit failure mode and a **STOP** (no next patch under this yes); see `autogit/gitupdate.md` step 12.5.
12. **Close-release / tags:** bump all four manifests (root + CLI + `agent-kit.json` + `plugin.json`); never force-move an already-pushed `v*` tag. Release-close stays its own PR to staging (do not bundle with a main-back-merge or product fix). Retry via a new **patch** tag when the fix must republish (**new** `/git-prod` confirm); **hold** (manifests stay on the tagged SemVer, no new tag) when the existing tarball is enough; local-only recreate before first push. Same rule as `autogit/gitupdate.md` SemVer / step 9.5.
