---
name: git-prod
description: Promote origin/staging to origin/main following the git prod routine (HITL confirmation required).
---

# Git prod

Follow the **git prod** routine to promote `origin/staging` to `origin/main` (production):

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

1. **Read** the "Prompt: git prod" section in `autogit/gitupdate.md` (when it exists in the project).
2. Critical validation: no uncommitted local changes; never commit directly to main.
3. Close the release in the CHANGELOG (move `[Unreleased]` to a dated version) before merging. Keep `<!-- changelog-private -->` fences. Public excerpt: `node scripts/public-changelog.mjs --version <X.Y.Z>` (GitHub Release body) and `--blurb` (landing `--notes`).
4. Show a summary of the changes (diff/log) between staging and main and **ask for explicit confirmation using Ask questions tool** before merging and pushing to main.
   
   Options: `Proceed with production deploy` / `Review changes first` / `Cancel`
   
   **Advisory (does not replace confirmation):** if Blocking untriaged `.cursor/memory/plan-monitor-*.md` match themes in the staging→main delta, mention them once in the summary. Never steal this Ask; Field Report / `/plan-review-triage` stay attention/HITL SoT.
   
   **Fallback:** if Ask questions tool unavailable, ask for explicit confirmation in chat.
5. **Agent signature gate (hard stop, before merge to main):** after the confirmation and before any merge or push, scan everything that would reach `main`: `git log origin/main..origin/staging --format=%B | sh git-hooks/prepare-commit-msg --check -`. When the promotion goes through a staging→main PR (the Claude CLI lane in `autogit/gitupdate.md`), also scan its body before merge: `gh pr view <N> --json body -q .body | sh git-hooks/prepare-commit-msg --check -`. Exit 0 prints `ok`. Exit 1 lists the offending lines: **stop**; the fix lands on `staging` through `/git-staging` (reword the commit on a working branch, or `gh pr edit <N> --body`), then re-run this step from the top. Exit 2 (missing hook file, grep failure) is red, not a pass. Never merge, push, or tag over a red scan. Same shape as the Evidence-checks gate in `/git-staging`; pattern list: `sh git-hooks/prepare-commit-msg --list`. ADR: `2026-09-11_agent-signature-guard-strip-hook-check-gate`.
6. Run merge to main, then push with the authorized inline form only:

   `ALLOW_MAIN_PUSH=1 git push origin main`

   Bare `git push origin main` stays denied by `agent-kit guard shell` and `git-hooks/pre-push`. Do not export `ALLOW_MAIN_PUSH=1` as a session environment variable. Do not add `--force`, `--no-verify`, or a non-main destination. Then create/push annotated vX.Y.Z tag (when absent) and confirm production. Details: `autogit/gitupdate.md` Prompt git prod step 9.
7. Update `.cursor/HANDOFF.md` ("promoted to production") and memory-loop WRITE if it applies.
8. In this monorepo: annotated tags trigger `publish-npm` + `sync-public` CI; `pnpm git:trigger-public-sync` fallback when needed per `autogit/gitupdate.md`.
9. **Post-prod verification (mandatory in this monorepo):** before ending, check tag CI jobs (`publish-npm`, `sync-public`), `npm view @dadado/agent-kit-cli version`, **public sync PR merged** (not CI-green alone), public `main` sync commit, and public GitHub Release Latest. Report each row. Silent npm success with a stale public Releases badge, or CI-green with an unmerged sync PR, is a kit failure mode; see `autogit/gitupdate.md` step 12.5.
10. **Close-release / tags:** bump all four manifests (root + CLI + `agent-kit.json` + `plugin.json`); never force-move an already-pushed `v*` tag. Retry via a new **patch** tag when the fix must republish; **hold** (manifests stay on the tagged SemVer, no new tag) when the existing tarball is enough; local-only recreate before first push. Same rule as `autogit/gitupdate.md` SemVer / step 9.5.
