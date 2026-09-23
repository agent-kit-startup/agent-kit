# Autogit - Automated Git Routines

Automated system for managing development, staging and production flow using simplified commands. Compatible with GitLab or GitHub (use `glab` or `gh` depending on your provider).

In **Agent Kit**, autogit is the **DevOps spine**: it structures the operational memory of agents together with plans, `/handoff` and memory-loop.

```
plan → /handoff → git staging → git prod → memory
```

## 📋 Available Commands

| Command | Alias / slash | Destination (in this repo) | Description |
|---------|---------------|----------------------------|-------------|
| `git staging` | `/git-staging` | `origin/staging` | Updates the staging branch with local changes |
| `git prod` | `/git-prod` | `origin/main` | Promotes `origin/staging` → `origin/main` (production) after approval |
| `kit staging` | `/kit-staging` | `origin/staging`, then optional landing staging | Git-staging routine, then landing field update + `landing:deploy:staging` only when a product changelog or release changed |
| `kit prod` | `/kit-prod` | `origin/main`, then optional landing promote | Git-prod routine (same HITL), then landing field update + `landing:promote` only when this promotion includes a release |

**Bundles vs native:** `/git-staging` and `/git-prod` remain the SoT for git-only work. They do not deploy the public landing. `/kit-staging` and `/kit-prod` wrap those prompts. After a public GitHub Release Latest is cut, private tag CI job `sync-landing` stamps missionkit.io (public excerpt blurb), deploys staging, then promotes the same `dist/` bytes. Fail-closed if Latest is missing or live fields stay stale. `/kit-prod` does not Ask `Promote landing to production` for that path. Design-canvas visual deploys still use `/kit-staging` HITL. Repo-only shipping stays `/git-staging` / `/git-prod`. Command SoT: `.cursor/commands/kit-staging.md`, `.cursor/commands/kit-prod.md`.

In legacy projects the pre-prod branch may be called `homologacao`, `develop`, etc. The **two-step pattern** is fixed; the canonical name in Agent Kit is **`staging`**.

## 🔄 Workflow

```
Local development 
    ↓
origin/staging (via `git staging`)
    ↓
origin/main - PRODUCTION (via `git prod`)
```

After staging or prod: update `.cursor/HANDOFF.md`. If the promote closed an incident or tradeoff decision, record it in `.cursor/memory/` (memory-loop).

## 🚀 How to Use

### 1. `git staging` - Development → Staging

Updates the `origin/staging` branch with local changes.

**What it does:**
- ✅ Security validation (blocks direct commits to `main`; local pre-commit hooks scan for secrets as a tripwire, but comprehensive secret protection requires additional CI-wide guards)
- ✅ Checks and updates `CHANGELOG.md` if necessary (bullets only in `[Unreleased]`)
- ✅ Syncs with `origin/staging`
- ✅ Creates working branch (`update/<scope>` or `feature/<name>`)
- ✅ Makes commit with semantic message (Conventional Commits)
- ✅ Creates Merge Request / Pull Request automatically
- ✅ Does automatic merge of the MR/PR
- ✅ Cleans up temporary branches
- ✅ *(Optional)* Updates task status in the repo's project manager (ClickUp, Jira, …) **only if** MCP/skill for that tool is configured


**Usage example:**
```
git staging
```

**Supported commit messages:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `docs(memory):` Plan-monitors, Audits index rows, memory ADRs
- `refactor:` Refactoring
- `chore:` Maintenance tasks
- `chore(kit):` Kit-command / HANDOFF-adjacent hygiene (own bucket when the product theme differs)

---

### 2. `git prod` - Staging → Production

Promotes approved changes from `origin/staging` to `origin/main` (production).

**⚠️ WARNING:** This command updates production. Use carefully!

**What it does:**
- ✅ Critical security validation
- ✅ Checks `CHANGELOG.md` and **closes the release** (moves `[Unreleased]` → dated version)
- ✅ Shows detailed summary of changes
- ✅ **Requires explicit confirmation** before proceeding (**one confirm, one ship**: one SemVer close, one `v*` tag, one promote)
- ✅ Merges `origin/staging` → `origin/main`
- ✅ Publishes to production
- ✅ **Mandatory** fast-forward of `origin/staging` to `origin/main` when staging is an ancestor (prevents promote sawtooth)
- ✅ In this monorepo: triggers public mirror sync (`pnpm git:trigger-public-sync`) when applicable; step 12.5 red/stale is a STOP, not a license for another patch under the same yes
- ✅ *(Optional)* Updates task status in the repo's project manager (ClickUp, Jira, …) **only if** MCP/skill for that tool is configured


**Usage example:**
```
git prod
```

**Before executing:**
- Make sure all changes have been tested in staging
- Check that `CHANGELOG.md` is up to date
- Review the change summary presented by the command

---

## 🔒 Protections and Validations

### Direct Commits to Main Blocked

**IMPORTANT**: Direct commits to `origin/main` are **BLOCKED**. All changes must follow the flow:

1. Local development → `origin/staging` (via `git staging`)
2. `origin/staging` → `origin/main` (via `git prod`)

**Mandatory validations:**
- ❌ **BLOCKED**: Direct push to `origin/main`
- ❌ **BLOCKED**: Direct merge of local branches to `origin/main`
- ✅ **ALLOWED**: Only promotion from `origin/staging` to `origin/main` via `git prod`

---

## ⚙️ Initial Setup

### Create staging branch

```bash
# Create staging branch
git checkout main
git pull origin main
git checkout -b staging
git push -u origin staging
```

**Configure branch protection (GitLab or GitHub):**
- **GitLab:** `Settings` → `Repository` → `Protected branches`
- **GitHub:** `Settings` → `Branches` → Branch protection rules

Configure:
- **Branch `main`**: Allowed to merge/push: Maintainers (or equivalent)
- **Branch `staging`**: Allowed to merge/push: Developers + Maintainers (or equivalent)

**Check remotes:**
```bash
git remote -v
```

---

## 📝 Standards and Conventions

### Semantic Versioning

We follow the [Semantic Versioning](https://semver.org/) standard:
- **MAJOR** (X.0.0): Incompatible changes
- **MINOR** (0.X.0): New backward-compatible features
- **PATCH** (0.0.X): Bug fixes, post-tag CI / Path C portability, and consumer fixes that must republish as a new npm tarball

**Hold vs next patch:** after a published `vX.Y.Z`, CI-unblock or fixture commits may keep the four manifests on `X.Y.Z` (**hold**) when the existing tarball does not need to change (step 12.5). Cut the **next patch** (`X.Y.(Z+1)`) and a new annotated tag when npm, Path C install, or the public Release must carry the fix. Never force-move a pushed `v*`. A next-patch SemVer is a **new** `/git-prod` (or `/kit-prod`) with its own confirm; a red or stale public sync on the just-cut tag does not authorize another close under the same yes (see Prompt git prod: one confirm, one ship). 5.x history that shipped only `x.y.0` after `v5.2.1` is practice, not a second cadence. Factory ADR: `2026-09-04_semver-patch-for-post-tag-and-consumer-fixes.md`. Marketplace / skill-catalog semver is a different layer (`docs/CONTRIBUTING.md`).

### Conventional Commits

We follow the [Conventional Commits](https://www.conventionalcommits.org/) standard:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Formatting (does not affect code)
- `refactor:` Refactoring
- `perf:` Performance improvement
- `test:` Tests
- `chore:` Maintenance tasks

### CHANGELOG.md

The `CHANGELOG.md` should be updated for significant changes:

```markdown
## [Unreleased]

## [YYYY.MM.DD] - YYYY-MM-DD
or
## [MAJOR.MINOR.PATCH] - YYYY-MM-DD

### Added
- Description of what was added

### Changed
- Description of what was changed

### Removed
- Description of what was removed

### Fixed
- Description of what was fixed
```

**Flow rule:**
- **`git staging`:** add bullets only in `[Unreleased]`.
- **`git prod`:** before merging `staging → main`, **close the release** - move everything from `[Unreleased]` to `## [YYYY.MM.DD] - YYYY-MM-DD` (today) or SemVer version and leave `[Unreleased]` empty. Set root and `packages/cli` `package.json` `"version"` to that same SemVer. Never promote with Unreleased full.

**Public excerpt:** keep `<!-- changelog-private -->` fences when closing a release. Public GitHub, GitHub Releases, and the landing product-notes field receive the stripped consumer/contributor notes only (`node scripts/public-changelog.mjs`). Landing stamp uses `--version X.Y.Z --blurb`, never `CHANGELOG.md` as `--notes-file`.

---

## ⚠️ Important Warnings

1. **NEVER** commit directly to `origin/main` without going through staging
2. **ALWAYS** update `CHANGELOG.md` for significant changes
3. **ALWAYS** use semantic commit messages (Conventional Commits)
4. **ALWAYS** validate changes before promoting to production
5. **NEVER** force push to protected branches without explicit authorization
6. **ALWAYS** review the change summary before executing `git prod`

---

## 🔧 Requirements

- Git configured
- Provider CLI: **GitLab** use `glab` ([GitLab CLI](https://gitlab.com/gitlab-org/cli)); **GitHub** use `gh` ([GitHub CLI](https://cli.github.com/)). Install and authenticate according to your remote repository.
- Appropriate branch permissions (Developer for `staging`, Maintainer for `main`)

**Optional — project manager:** If the project has MCP/skill for a PM tool (ClickUp, Jira, Linear, etc.), the `git staging` and `git prod` routines can update related task status. Agent Kit does **not require** any PM tool; without integration, the step is skipped.


---

## 📚 Branch Structure

```
main (production)
  ↑
staging (pre-production)
  ↑
feature/* (development)
update/* (quick updates)
```

---

## 🆘 Troubleshooting

### Error: "Direct commits to main are blocked"
**Solution**: Use `git staging` to promote changes via staging.

### Error: "Protected branch"
**Solution**: Check your permissions on GitLab/GitHub. Developers can work on `staging`, only Maintainers can merge to `main`.

### Error: "glab not authenticated" or "gh not authenticated"
**When this applies:** the host CLI has never been logged in, or the operator asked to re-authenticate. This is **not** the first action after a successful SSH `git push` when `gh pr create` / `glab mr create` returns HTTP 401.
**First action after SSH already worked:** stay on Prompt git staging §9: print the compare/create URL and await. Do not invent a token harness, dotenv loader, or L0/CHANGELOG "fix."
**If the operator then asks to re-auth:** run `glab auth login` (GitLab) or `gh auth login` (GitHub).

### Error: "staging branch not found"
**Solution**: Create the branch with `git checkout -b staging` and publish with `git push -u origin staging`. In legacy repositories with `homologacao`, create `staging` from it and migrate.

---

## 🤖 Technical Prompts for AI

This section contains the detailed prompts that should be followed when commands are executed via AI.

### Prompt: git staging

> ### Whenever I type `git staging` in the chat, follow exactly the routine below to update `origin/staging` with local changes:

#### 1. **Security Validation**  
   - Run `git status -sb` to check modified, staged files and current branch.
   - **BLOCK**: If attempting to commit directly to `main` or `origin/main`, BLOCK and inform: "Direct commits to main are blocked. Use 'git staging' to promote changes via staging."
   - **Inventory the dirty tree** (do not stop-and-quiz because a path looks "out of the current flow"):
     1. List every uncommitted path.
     2. **Hard exclude** (never stage): secrets, PII, `.env` / keys / credentials, design-source dumps that belong in gitignore.
     3. **Theme-bucket** the rest:
        - **Product:** the current feature/fix/docs theme (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `perf:`).
        - **Kit/memory:** versioned HANDOFF (when tracked), intentional plan files, `plan-monitor-*.md`, `_index.md` Audits rows (`docs(memory):` or `chore(kit):`).
     4. Ship every **safe** bucket add-by-name (product commit first, then kit/memory as its own commit when the theme differs). Same PR is allowed; prefer a separate commit when the product diff is large.
     5. After all safe buckets ship, the tree must be clean except hard excludes. Leftover safe dirt means the inventory is incomplete: bucket and ship, do not abandon.
     6. **Ask HITL stays on `/git-prod`** (and on true risk: secrets, PII, ambiguous product scope). Do **not** invent a theme-Ask stop for routine dirty soft kit paths.

#### 2. **Check and Update CHANGELOG.md**  
   - Check if `CHANGELOG.md` exists and read its content.
   - If there are significant changes, **MANDATORY** update the `CHANGELOG.md`:
     - Add bullets **only in `[Unreleased]`** (don't create new version here)
     - Sections: `### Added`, `### Changed`, `### Removed`, `### Fixed`
     - Describe changes clearly and objectively
   - If there are no significant changes, confirm that updating the CHANGELOG is not necessary.
   - **Don't** close release in this routine - that's `git prod`'s responsibility.

#### 3. **Ensure local staging branch**  
   - Run `git checkout staging` to switch to local staging branch.
   - If the branch doesn't exist locally, run `git checkout -b staging origin/staging` (if it exists remotely) or `git checkout -b staging`.
   - If checkout fails (due to conflicts or local changes), resolve following user guidance before proceeding.

#### 4. **Sync with origin/staging**  
   - Run `git fetch --prune` to update remote references.
   - Run `git pull --ff-only origin staging` to sync with `origin/staging`.
   - If pull requires merge or rebase, stop and inform the user.

#### 5. **Create working branch**  
   - Analyze the necessary updates and define a branch name following the pattern: `update/<scope>-<descriptor>` or `feature/<feature-name>`.
   - Use `git checkout -b update/<...>` or `git checkout -b feature/<...>` to create and switch to the new branch.

#### 6. **Apply and review updates**  
   - Make the requested changes (including CHANGELOG.md update if necessary).
   - Review with `git status -sb` to ensure only expected files were modified.
   - **Validation**: Confirm there's no attempt to modify `origin/main` directly.
   - **Lint evidence (staging-ready):** when the diff touches formatted/linted paths (e.g. `*.ts` / `*.tsx` / `*.js` / `*.mjs` under `packages/` or other Biome/ESLint scopes), **run** the focused linter on those files (e.g. `pnpm exec biome check <paths>`) **before** commit and **record the exact command + pass/fail output** in the tick / worker summary. Claiming `Staging ready: yes` or pasting the contract phrase without that recorded run is invalid. **`dashboard/dashboard.html` is outside Biome** (`biome check dashboard/dashboard.html` processes nothing): for dashboard CSS/HTML-only diffs, record `Tests: none applicable (dashboard-CSS); covered by plugin-ux-validation` when the UX suite pins the change (ADR `decisions/2026-07-29_dashboard-css-lint-evidence-convention.md`); do not claim Biome covered the HTML. Pure markdown / docs-only with no applicable repo linter: record `Tests: none applicable` (or `Validation: none applicable`). Aligns with `/run-plan` Staging-ready lint gate (background: Biome-red merges fixed only after the fact).

#### 7. **Stage and commit with semantic message**  
   - Add relevant files with `git add` **by name**. Never broad-`git add` `.cursor/memory/` WIP into a product commit (ADR `decisions/2026-07-27_plan-monitor-consumer-awareness.md`).
   - If `git status` shows untracked or unrelated dirty `.cursor/memory/plan-monitor-*.md`, **warn**, then **bucket** (warn is not leave-dirty-forever):
     - Closeout evidence for **this** product change: add-by-name into the product commit only when it is that change's monitor (still prefer a separate `docs(memory):` commit when the product diff is large).
     - Remaining **safe** monitors, versioned HANDOFF, and kit docs: ship in a `docs(memory):` or `chore(kit):` commit in this `/git-staging` run. Unrelated-plan monitors still get their own kit/memory bucket; they do not ride along inside the product commit.
     - Hard excludes stay unstaged.
   - **Monitor closeout (R14):** when a tick intentionally stages a `plan-monitor-*.md` (and/or `_index.md` Audits row), add those paths **by name**. Prefer a separate docs/memory commit when the same PR also has large product diffs. Never sweep unrelated monitor WIP into a product commit. **An `_index.md` Audits row and its target monitor file must land in the same commit** (no index link without the file). Product commits must not pick up unrelated untracked monitors (dogfood residual R7). ADR: `decisions/2026-07-29_plan-monitor-staging-hygiene-r14-r15.md`.
   - Create a commit following [Conventional Commits](https://www.conventionalcommits.org/):
     - `feat:` for new features
     - `fix:` for bug fixes
     - `docs:` for documentation
     - `docs(memory):` for plan-monitors, `_index.md` Audits rows, memory ADRs
     - `refactor:` for refactoring
     - `chore:` for maintenance tasks
     - `chore(kit):` for kit-command / HANDOFF-adjacent hygiene that is not the product theme
   - Example: `git commit -m "feat: add support for new agent"` or `git commit -m "fix: correct CPF validation"`
   - If CHANGELOG.md was updated, mention it in the commit: `git commit -m "feat: add new agent\n\nUpdate CHANGELOG.md with new version"`

#### 8. **Publish branch**  
   - **Agent signature gate (hard stop, before the push):** run `git log origin/staging..HEAD --format=%B | sh git-hooks/prepare-commit-msg --check -`. Exit 0 prints `ok`; exit 1 lists the commit-message lines that carry a coding-agent signature or session link (`Co-Authored-By: Claude ... <noreply@anthropic.com>`, `Claude-Session: https://claude.ai/code/...`, Cursor / Copilot / Codex / Devin trailers, `🤖 Generated with <agent>`, agent session URLs; `sh git-hooks/prepare-commit-msg --list` prints the rules). On exit 1 **stop**, reword the commit(s) on the working branch (`git commit --amend`, or `git rebase -i` for older ones) and re-run until it prints `ok`. Exit 2 (missing hook file, grep failure) is red, not a pass. Never push over a red scan and never use `--no-verify` to get past it. A squash merge copies every branch commit message into the `staging` commit, so a trailer on any branch commit would otherwise reach `staging` and then `main`. ADR `.cursor/memory/decisions/2026-09-11_agent-signature-guard-strip-hook-check-gate.md`.
   - Run `git push -u origin update/<...>` or `git push -u origin feature/<...>` to send the branch to remote.

#### 9. **Open and merge Merge Request / Pull Request**  
   - **GitLab:** Create the MR with `glab mr create --title "<title>" --description "<description>" --target-branch staging`. Then run `glab mr merge <number>` to merge. If it fails due to authentication, provide the manual creation link and await instructions.
   - **GitHub:** Create the PR with `gh pr create --title "<title>" --body "<description>" --base staging`. **Always pass `--base staging`** (default base is often `main`; never merge staging work straight to `main`). Then run `gh pr merge <number>` (or the returned number). If it fails due to authentication, provide the manual creation link and await instructions.
   - **Stay on this command (auth fail / HTTP 401):** After a successful SSH push, if `gh pr create` or `glab mr create` fails due to authentication (including HTTP 401), print the compare or create URL and await. GitHub compare form: `https://github.com/<owner>/<repo>/compare/staging...<branch>`. Do **not** invent product (dotenv, L0, CHANGELOG, overlay-hash, hard-rules harness). Do **not** load `.env` or `GH_TOKEN` as a GitHub token source. Do **not** leave `/git-staging` for a new feature. HTTP 401 after SSH push is not "CLI never configured." When auth recovers in the same chat, resume at create / signature scan / merge only. Troubleshooting `gh auth login` is not the first move here. Inventory → theme-bucket → ship (Prompt §1) still applies; auth-block is not a license to open a second product theme.
   - **Agent signature gate on the PR body (hard stop, before merge):** run `gh pr view <N> --json body -q .body | sh git-hooks/prepare-commit-msg --check -` (GitLab: `glab mr view <N> -F json | jq -r .description | sh git-hooks/prepare-commit-msg --check -`). Exit 1 lists the offending body lines: **stop**, `gh pr edit <N> --body "<clean body>"`, re-run until `ok`. The PR body becomes part of the squash commit on some GitHub settings, so it is scanned like a commit message. Same exit-code contract as step 8; same shape as the Evidence-checks gate below.
   - **Evidence-checks merge gate (before merge / Gaps-none):** run `gh pr checks <N>` and confirm `build` (including the **Evidence checks** step) is green. Do **not** merge while required checks are pending or failing. If Evidence checks fail (`knowledge-classification.json` stale or missing `_index` targets), regenerate/fix and re-push before merge; do not write HANDOFF `- **Gaps:** none` over red. Optional operator follow-up: require `build` as a branch-protection check on `staging` (not a silent workflow edit). ADR: `.cursor/memory/decisions/2026-08-01_evidence-checks-merge-gate.md`.

#### 10. **Cleanup and final update**  
   - Run `git checkout staging` to return to staging branch (needed before deleting working branch).
   - Delete the remote branch on origin with `git push origin --delete update/<...>` or `git push origin --delete feature/<...>`.
   - Delete the local branch with `git branch -D update/<...>` or `git branch -D feature/<...>` (use `-D` since merge was done remotely and Git might not detect locally).
   - Update local `staging` with `git pull --ff-only origin staging` to incorporate merged changes.
   - Confirm clean state with `git status -sb`. If leftover **safe** dirt remains (HANDOFF, monitors, kit docs), return to §1 inventory and ship the remaining bucket. Hard excludes may remain unstaged.

#### 10.5. **Project manager — optional**  
   - **If** the project has PM tool MCP/skill configured: update related task status (e.g., "in staging"). If the user indicated task(s) or there's context in handoff/plan, update them. No tool or no tasks: skip without warning.


#### 11. **Report**  
   - Summarize executed actions, inform merge status, mention if CHANGELOG.md was updated and any necessary follow-ups.
   - Update `.cursor/HANDOFF.md` (phase in staging); if appropriate, memory-loop WRITE.

---

### Prompt: git prod

> ### Whenever I type `git prod` in the chat, follow exactly the routine below to promote changes from `origin/staging` to `origin/main` (production):

**Claude CLI lane, known blockers (read once before running, saves retries):** The Claude Code auto-mode permission classifier blocks the agent running `ALLOW_MAIN_PUSH=1 git push origin main`. This repo's private `agent-kit-dev` also has a `Protect main and staging` ruleset (PR-only on both branches). Full detail and recurrence history in `.cursor/memory/errors/2026-08-14_git-prod-private-main-requires-pr.md` and `.cursor/memory/errors/2026-07-24_public-sync-pr-merge-blocked-ruleset.md`. The short version:

**Classifier-blocked (any repo):**

| Command | Expect it to work? |
|---|---|
| Agent running `ALLOW_MAIN_PUSH=1 git push origin main` (step 9) | **No.** Permission classifier blocks the agent. Do not retry. Use the Ask in step 9. The operator may run the same command. |

**Classifier refusal observed on `agent-kit-dev` and the public mirror only:**

| Command | Expect it to work? |
|---|---|
| `gh pr merge` | **No** on those two repos. One attempt is enough to log; the merge is operator-owed. Do not predict this for every consumer repo. A consumer repo accepted `gh pr merge` on staging PRs (`agent-kit-startup/agent-kit#53`). |

**Factory ruleset-blocked (`agent-kit-dev` only):**

| Command | Expect it to work? |
|---|---|
| Direct `git push origin main` (step 9) | **No.** GitHub ruleset requires a PR. |
| Any direct `git push origin staging` (e.g. closing the release) | **No.** Same ruleset covers `staging`. Commit on a fresh branch, PR to `staging` instead. |
| `gh pr merge` additionally erroring `head branch is not up to date with base branch` | Usually means a prior promote skipped the **mandatory** step 10 FF sync, so `main` still has a merge-commit SHA that `staging` never received. After every successful push of `main`, step 10 must FF `staging` when `origin/staging` is an ancestor of `origin/main`. Do **not** open a staging PR whose only job is to "record `origin/main` as ancestor" during this prod run. If staging is **not** an ancestor (new staging commits landed during the promote), stop and say so; a later `/git-staging` may integrate `main` as its own staging PR. When the check still blocks an otherwise clean promote, surface it; the operator may need `--admin` or a UI merge to clear a historical gap. |

**Not blocked:**

| Command | Expect it to work? |
|---|---|
| `gh pr create`, `gh release create`, `git push origin <new-branch>` | **Yes**, these are not classifier-blocked — safe to run directly. |

**One confirm, one ship (hard stop):** `Proceed with production deploy` authorizes exactly one SemVer close, one annotated `v*` tag, and one promote of `staging` → `main`. A red or stale public sync (step 12.5: public sync PR not merged, public Release Latest ≠ the tag just cut, or `sync-landing` failed) is a **STOP**. It does not authorize another patch, another release-close, or another promote under the same yes. The next ship needs a new confirm Ask. **Done** for that ship: private `main`, the npm version, the merged public sync PR, and public GitHub Release Latest all name the same `vX.Y.Z`.

**`/run-plan-all` ship lane:** when HANDOFF `- **Ship auth:**` is `per-plan-release`, skip the confirm Ask in this prompt. That queue confirm is the yes for this plan's one ship. A red step 12.5 still stops the queue. Do not cut another tag, and do not start the next queued plan, until this ship is Done.

#### 1. **CRITICAL Security Validation**  
   - Run `git status -sb` to check modified, staged files and current branch.
   - **CRITICAL BLOCK**: 
     - ❌ **BLOCKED**: If there are uncommitted local changes, BLOCK and inform: "Cannot promote to production with uncommitted local changes. Commit or discard changes first."
     - ❌ **BLOCKED**: If attempting to commit directly to `main` or `origin/main` without going through `origin/staging`, BLOCK and inform: "Direct commits to main are blocked. All changes must go through staging first."
     - ✅ **ALLOWED**: Only promotion from `origin/staging` to `origin/main` after staging approval.

#### 2. **Check versioning and CHANGELOG.md**  
   - Run `git fetch origin` to update references.
   - Run `git log origin/staging --oneline -10` to check recent commits.
   - **Close release (mandatory if `[Unreleased]` has content):**
     1. Move all bullets from `[Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (SemVer + today's date). If today's SemVer section already exists, **merge** into it.
     2. Leave `[Unreleased]` empty (heading only).
     3. **Bump all four runtime manifests to the same SemVer** (ADR `2026-07-28_git-prod-version-manifest-parity`):
        - root `package.json`
        - `packages/cli/package.json`
        - `.cursor/agent-kit.json`
        - `.cursor-plugin/plugin.json`
        Do not ship with only root+CLI bumped; L0 version-parity tests fail and tag CI skips publish/sync.
     4. **Required before the first `v*` tag push for this SemVer:** on staging (or the commit about to become `main`), run `pnpm typecheck` and `pnpm test` (or at least focused L0 version-parity: `vitest` on `packages/cli/src/lifecycle/l0.test.ts` **plus** `pnpm typecheck`). Do not treat this as optional: tag CI that fails typecheck skips `publish-npm` / `sync-public` (see `errors/2026-07-29_tag-ci-typecheck-blocked-481-publish.md`).
     5. Commit this change to working branch / staging **before** merging to `main` (via MR if necessary).
     6. **Release-close stays its own PR to staging.** Do not bundle release-close + a main-back-merge + a product fix in one staging PR. Close-release commits only; integrate `main` later via `/git-staging` when needed (and only when FF is impossible; see step 10).
   - If Unreleased is already empty and today's release reflects what's in staging, still verify all four manifests match the latest closed CHANGELOG version; bump and commit if they do not.

#### 3. **Sync branches**  
   - Run `git fetch --prune` to update remote references.
   - Check if `staging` branch exists remotely with `git branch -r | grep origin/staging`.
   - If it doesn't exist, inform the user and stop.

#### 4. **Update local staging branch**  
   - Run `git checkout staging` to switch to staging branch.
   - Run `git pull --ff-only origin staging` to sync with remote.
   - If pull requires merge or rebase, stop and inform the user.

#### 5. **Check differences between origin/staging and origin/main**  
   - Run `git fetch origin main` to fetch remote main branch.
   - Run `git log origin/main..origin/staging --oneline` to list commits in `origin/staging` but not in `origin/main`.
   - Run `git diff origin/main..origin/staging --stat` to see a summary of changes.
   - **Agent signature gate (hard stop):** run `git log origin/main..origin/staging --format=%B | sh git-hooks/prepare-commit-msg --check -`. Exit 0 prints `ok`. Exit 1 lists commit-message lines in the promotion delta that carry a coding-agent signature or session link: **stop** before the confirmation; the fix goes through `git staging` (reword on a working branch, PR to `staging`), then restart this routine. Exit 2 (missing hook file, grep failure) is red, not a pass. Never merge, push, or tag over a red scan. Same list as step 8 of `git staging`; ADR `.cursor/memory/decisions/2026-09-11_agent-signature-guard-strip-hook-check-gate.md`.
   - **Present the user with a detailed summary of changes that will be promoted to production and request explicit confirmation before proceeding.**

#### 6. **Update local main**  
   - Run `git checkout main` to switch to main branch.
   - Run `git pull --ff-only origin main` to ensure it's up to date.
   - If pull requires merge or rebase, stop and inform the user.

#### 7. **Merge origin/staging to origin/main**  
   - **Generate dynamic commit message** based on commits being promoted:
     - Analyze commits listed in `git log origin/main..origin/staging --oneline`.
     - Create a concise summary (maximum 72 characters) reflecting the main changes.
     - **Message format**: `Merge origin/staging: <change summary>`
     - **Examples**:
       - If commits are about documentation: `Merge origin/staging: Update docs and remove obsolete files`
       - If commits are about features: `Merge origin/staging: Add campaign system and test fixes`
       - If commits are about fixes: `Merge origin/staging: Backend bug fixes and validations`
       - If mixed changes, prioritize most significant: `Merge origin/staging: New events API + updated docs`
     - **Tip**: Use commit prefixes (feat, fix, docs, etc.) to identify predominant change type.
   - Run `git merge --no-ff origin/staging -m "<generated message>"` to merge preserving history. `--no-ff` keeps a real merge commit on `main` even when a fast-forward would have been possible; that merge commit is a SHA `staging` does not have until step 10. The mandatory FF sync in step 10 is what prevents the promote sawtooth (agents opening main→staging merge PRs that only "record `origin/main` as ancestor").
   - Prefer keeping `--no-ff` for the promote. Do not invent a squash-only promote unless an Accepted ADR says otherwise. When the staging→main PR path is used instead (`gh pr create --base main --head staging`), still prefer a real merge onto `main` over a squash that rewrites the tip staging already carries.
   - The generated merge message must itself pass the gate: `printf '%s\n' "<generated message>" | sh git-hooks/prepare-commit-msg --check -` (no trailer, no session link). When this lane promotes through a staging→main PR instead (`gh pr create --base main --head staging`, see the blockers table above), scan that PR body before the operator merge: `gh pr view <N> --json body -q .body | sh git-hooks/prepare-commit-msg --check -`; exit 1 means `gh pr edit <N> --body` first.
   - If there are conflicts, stop and inform the user for manual resolution.

#### 8. **Validate merge**  
   - Run `git status -sb` to verify merge completion.
   - Run `git log --oneline -5` to confirm commits were incorporated.
   - Check that CHANGELOG.md is present and updated.

#### 9. **Publish main (PRODUCTION)**  
   - **WARNING**: This is the critical step that updates production.
   - **Claude Code lane (or a recorded classifier denial of this push):** Do not run `ALLOW_MAIN_PUSH=1 git push origin main`. After local main preparation (merge `--no-ff`, signature scan green), Ask with these exact labels:
     - `I pushed main`
     - `Open staging→main PR instead`
     - `Cancel`
   - **On `I pushed main`:** The operator already pushed. Verify `origin/main` advanced, then continue with the annotated tag (step 9.5), staging sync (step 10), and the report. Do not run the push.
   - **On `Open staging→main PR instead`:** While on local `main`, run `git reset --hard origin/main`, then `gh pr create --base main --head staging`. Prefer a merge commit. Wait for the operator to merge the PR.
   - **On `Cancel`:** Stop. Do not tag, push, or open a PR.
   - **Other lanes:** Run `ALLOW_MAIN_PUSH=1 git push origin main` to send changes to production (the local `pre-push` hook and the agent Shell `guard shell` both block bare pushes to `main`; this env gate is the authorized `/git-prod` path, see `git-hooks/README.md`). Agent Shell: use the same inline form. CLI SoT (`agent-kit guard shell`) honors `ALLOW_MAIN_PUSH=1` before stripping env prefixes; bare `git push origin main` stays denied. **IMPORTANT**: Avoid setting `ALLOW_MAIN_PUSH=1` as a persistent session environment variable. Use the inline prefix form for authorized single commands only. **NEVER** force push without explicit user authorization. Prefer `ALLOW_MAIN_PUSH=1` over `--no-verify` so other hooks still run. Then continue with the annotated tag (step 9.5).

#### 9.5. **Create and push annotated tag (when absent)**  
   - Check if tag exists for current version: `git tag -l "v<version>"` where `<version>` matches `package.json`.
   - If tag does not exist, create annotated tag: `git tag -a v<version> -m "Release v<version>"` on the current main commit.
   - Push the tag: `git push origin v<version>`.
   - **Effect**: Annotated vX.Y.Z tags trigger CI `publish-npm` job (when `NPM_TOKEN` configured) and `sync-public` workflow (when `PUBLIC_REPO_TOKEN` configured).
   - **Immutable tags — never force-move `v*`:**
     - Do **not** `git push --force` (or delete-and-recreate in place) an existing `vX.Y.Z` that already pointed at another SHA. Consumers and mirrors may have resolved the old tip.
     - If tag CI fails after the first push: fix on a new commit. **Hold** (keep manifests on the tagged SemVer, no new tag) when the existing npm tarball can stay. **Next patch** plus a **new** annotated tag when npm / Path C / public Release must carry the fix. Do not rewrite history of a published `v*`. Same fork as [Semantic Versioning](#semantic-versioning) and ADR `2026-09-04_semver-patch-for-post-tag-and-consumer-fixes.md`.
     - If the tag was never pushed remotely and only exists locally on a bad tip: delete the **local** tag (`git tag -d vX.Y.Z`) and recreate on the fixed commit, then push once.
     - Optional hardening: GitHub ruleset protecting `v*` from force-update/deletion; local `pre-push` blocks force-update/delete of `refs/tags/v*` unless `ALLOW_TAG_FORCE=1` (see `git-hooks/pre-push`).

#### 10. **Sync staging (mandatory after main is pushed)**  
   Immediately after `origin/main` is updated (step 9) and the annotated tag is handled (step 9.5):

   1. `git fetch origin`
   2. If `git merge-base --is-ancestor origin/staging origin/main` succeeds (`origin/staging` is an ancestor of `origin/main`):
      - `git checkout staging`
      - `git merge --ff-only origin/main` (fast-forward only; do **not** open a merge PR that merely records `origin/main` as ancestor)
      - Push staging (`git push origin staging`, or a PR whose only change is that FF tip when the ruleset blocks direct push)
   3. If staging is **not** an ancestor (new staging commits landed during the promote): **stop and report**. Do not invent a main→staging back-merge in this prod session. A later `/git-staging` may integrate `main`; that integration is its own staging PR, not bundled with a release-close.
   4. Never tell the agent to `git merge origin/main` (non-FF) into staging when `git merge --ff-only origin/main` would succeed.

#### 11. **Cleanup and confirmation**  
   - Run `git checkout main` to return to main branch.
   - Run `git status -sb` to confirm clean state.
   - Run `git log --oneline -10` to show recent commits including the merge.

#### 11.5. **Project manager — optional**  
   - **If** the project has PM tool MCP/skill configured: update status of promotion-related tasks (e.g., "completed"). No tool or no tasks: skip without warning.

#### 12. **Public mirror sync (this monorepo)**  
   - **Primary**: Annotated vX.Y.Z tag (step 9.5) automatically triggers `sync-public` CI when `PUBLIC_REPO_TOKEN` is configured.
   - **Fallback**: If tag was not created or manual dispatch needed, run **`pnpm git:trigger-public-sync`** (or `bash scripts/trigger-public-sync-after-prod.sh`) to trigger CI workflow with public repository sync. See `docs/repository-boundaries.md`.
   - In projects without public mirror, skip this step.

#### 12.5. **Post-prod verification (this monorepo — do not skip)**  
   Tag push alone is not proof that consumers see the release. Before closing the chat, verify and report:

   | Check | How |
   |-------|-----|
   | Private tag CI | `gh run list` for the `vX.Y.Z` tag: `build`, `publish-npm`, `sync-public`, and `sync-landing` all green. A red `sync-landing` is a STOP (fail-closed). `build` / `publish-npm` / `sync-public` green does not pass this row while `sync-landing` is red |
   | Public storefront tag CI (advisory) | On `agent-kit-startup/agent-kit`, tag/Release runs should show `build` green with `sync-public` / `publish-npm` **skipped** (not failed; allowlist is `github.repository == 'agent-kit-startup/agent-kit-dev'`). The guard lands on the mirror only after Path C syncs the updated `ci.yml` (one-release lag). Do not treat a skipped public sync job as a private sync failure. |
   | npm | `npm view @dadado/agent-kit-cli version` matches the release |
   | Public sync PR **merged** | `sync-public` may open a PR; do **not** pass this row on CI-green alone. Confirm the public sync PR is **merged** (`gh pr view` / `gh pr list -R <public> --state merged`) before claiming public `main` is current |
   | Public `main` | Latest commit message like `chore: sync private vX.Y.Z (...)` on the public default branch **after** that merge |
   | Public GitHub Release | `gh release list -R <public>` shows `vX.Y.Z` as Latest (not a stale older release) |
   | Scoped-install Path C smoke (manual or CI) | Install `@dadado/agent-kit-cli@X.Y.Z` into a blank folder under `node_modules/@dadado/…` (no kit checkout) and confirm `agent-kit dashboard` reaches HTTP 200 on loopback; required after Path C / detach-start changes |

   **Post-tag `main` commits:** After a `vX.Y.Z` tag ships, CI-unblock or fixture commits may land on `main` while manifests still say `X.Y.Z` (**hold**). That is allowed only when documented in the promote notes / HANDOFF (tag and npm tarball describe the tagged commit, not necessarily later `main`). Realign with the **next patch** when product fixes (for example Path C) must reach npm; never force-move the existing `v*` tag. See [Semantic Versioning](#semantic-versioning).

   If `sync-public` failed, `sync-landing` failed, the sync PR is still open, or the public Release is missing / Latest is stale: **STOP**. The promote is unfinished until private `main`, npm, the merged public sync PR, and public Release Latest agree on that tag. Fix or re-run (`pnpm git:trigger-public-sync`), do not assume success from a green local merge/push or from tag CI alone. Do **not** close a next patch, cut another `v*`, or re-run promote under the same confirm; that is a new `/git-prod` (or `/kit-prod`) Ask. Write a memory/dogfood note when the gap was silent (npm green, public storefront stale; or CI green, sync PR unmerged).

#### 13. **Final Report**  
   - Summarize executed actions, list commits promoted to production, inform merge status, mention if CHANGELOG.md was updated and any necessary follow-ups.
   - **Highlight**: Clearly inform that changes are now in production (`origin/main`).
   - Include the step 12.5 verification results (pass/fail per row).
   - Update `.cursor/HANDOFF.md` ("promoted to production"); if appropriate, memory-loop WRITE.

---

## Naming: `staging`, `homologacao` and migration

- **Canonical:** `staging` (i18n, aligned with GitHub/GitLab and other ecosystem projects).
- **Legacy:** old repositories may still have `homologacao`; `git homolog` is accepted as synonym for `git staging` and operates on existing pre-prod branch.
- **Migration:** create `staging` from `homologacao` (`git checkout homologacao && git checkout -b staging && git push -u origin staging`), update branch protection and open MRs, then retire `homologacao`.
- **Production** is deploy/CI *environment*, not mandatory branch name — `main` remains the destination for `git prod`.
