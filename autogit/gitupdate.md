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
- ✅ Security validation (blocks direct commits to `main`)
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
- `refactor:` Refactoring
- `chore:` Maintenance tasks

---

### 2. `git prod` - Staging → Production

Promotes approved changes from `origin/staging` to `origin/main` (production).

**⚠️ WARNING:** This command updates production. Use carefully!

**What it does:**
- ✅ Critical security validation
- ✅ Checks `CHANGELOG.md` and **closes the release** (moves `[Unreleased]` → dated version)
- ✅ Shows detailed summary of changes
- ✅ **Requires explicit confirmation** before proceeding
- ✅ Merges `origin/staging` → `origin/main`
- ✅ Publishes to production
- ✅ In this monorepo: triggers public mirror sync (`pnpm git:trigger-public-sync`) when applicable
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
- **PATCH** (0.0.X): Bug fixes

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
- **`git prod`:** before merging `staging → main`, **close the release** - move everything from `[Unreleased]` to `## [YYYY.MM.DD] - YYYY-MM-DD` (today) or SemVer version and leave `[Unreleased]` empty. Never promote with Unreleased full.

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
**Solution**: Run `glab auth login` (GitLab) or `gh auth login` (GitHub) to authenticate.

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
   - If there are uncommitted local changes that don't belong to the current flow, stop and request instructions.

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

#### 7. **Stage and commit with semantic message**  
   - Add relevant files with `git add`.
   - Create a commit following [Conventional Commits](https://www.conventionalcommits.org/):
     - `feat:` for new features
     - `fix:` for bug fixes
     - `docs:` for documentation
     - `refactor:` for refactoring
     - `chore:` for maintenance tasks
   - Example: `git commit -m "feat: add support for new agent"` or `git commit -m "fix: correct CPF validation"`
   - If CHANGELOG.md was updated, mention it in the commit: `git commit -m "feat: add new agent\n\nUpdate CHANGELOG.md with new version"`

#### 8. **Publish branch**  
   - Run `git push -u origin update/<...>` or `git push -u origin feature/<...>` to send the branch to remote.

#### 9. **Open and merge Merge Request / Pull Request**  
   - **GitLab:** Create the MR with `glab mr create --title "<title>" --description "<description>" --target-branch staging`. Then run `glab mr merge <number>` to merge. If it fails due to authentication, provide the manual creation link and await instructions.
   - **GitHub:** Create the PR with `gh pr create --title "<title>" --body "<description>" --base staging`. Then run `gh pr merge <number>` (or the returned number). If it fails due to authentication, provide the manual creation link and await instructions.

#### 10. **Cleanup and final update**  
   - Run `git checkout staging` to return to staging branch (needed before deleting working branch).
   - Delete the remote branch on origin with `git push origin --delete update/<...>` or `git push origin --delete feature/<...>`.
   - Delete the local branch with `git branch -D update/<...>` or `git branch -D feature/<...>` (use `-D` since merge was done remotely and Git might not detect locally).
   - Update local `staging` with `git pull --ff-only origin staging` to incorporate merged changes.
   - Confirm clean state with `git status -sb`.

#### 10.5. **Project manager — optional**  
   - **If** the project has PM tool MCP/skill configured: update related task status (e.g., "in staging"). If the user indicated task(s) or there's context in handoff/plan, update them. No tool or no tasks: skip without warning.


#### 11. **Report**  
   - Summarize executed actions, inform merge status, mention if CHANGELOG.md was updated and any necessary follow-ups.
   - Update `.cursor/HANDOFF.md` (phase in staging); if appropriate, memory-loop WRITE.

---

### Prompt: git prod

> ### Whenever I type `git prod` in the chat, follow exactly the routine below to promote changes from `origin/staging` to `origin/main` (production):

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
     1. Move all bullets from `[Unreleased]` to `## [YYYY.MM.DD] - YYYY-MM-DD` (today's date) or SemVer version. If today's section already exists, **merge** into it.
     2. Leave `[Unreleased]` empty (heading only).
     3. Commit this change to working branch / staging **before** merging to `main` (via MR if necessary).
   - If Unreleased is already empty and today's release reflects what's in staging, proceed.

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
   - Run `git merge --no-ff origin/staging -m "<generated message>"` to merge preserving history.
   - If there are conflicts, stop and inform the user for manual resolution.

#### 8. **Validate merge**  
   - Run `git status -sb` to verify merge completion.
   - Run `git log --oneline -5` to confirm commits were incorporated.
   - Check that CHANGELOG.md is present and updated.

#### 9. **Publish main (PRODUCTION)**  
   - **WARNING**: This is the critical step that updates production.
   - Run `ALLOW_MAIN_PUSH=1 git push origin main` to send changes to production (the local `pre-push` hook blocks bare pushes to `main`; this env gate is the authorized `/git-prod` path — see `git-hooks/README.md`).
   - If push fails (e.g., protected branch), inform user and provide alternative instructions.
   - **NEVER** force push (`--force` or `--force-with-lease`) without explicit user authorization.
   - Prefer `ALLOW_MAIN_PUSH=1` over `--no-verify` so other hooks still run.

#### 10. **Sync staging (optional)**  
   - Run `git checkout staging` to return to staging branch.
   - Run `git merge --ff-only origin/main` to sync staging with main (if applicable).
   - Run `git push origin staging` to update remote.

#### 11. **Cleanup and confirmation**  
   - Run `git checkout main` to return to main branch.
   - Run `git status -sb` to confirm clean state.
   - Run `git log --oneline -10` to show recent commits including the merge.

#### 11.5. **Project manager — optional**  
   - **If** the project has PM tool MCP/skill configured: update status of promotion-related tasks (e.g., "completed"). No tool or no tasks: skip without warning.

#### 12. **Public mirror sync (this monorepo)**  
   - With `public` remote configured and `gh` authenticated, run **`pnpm git:trigger-public-sync`** (or `bash scripts/trigger-public-sync-after-prod.sh`) to trigger CI workflow with public repository sync. See `docs/repository-boundaries.md`.
   - In projects without public mirror, skip this step.

#### 13. **Final Report**  
   - Summarize executed actions, list commits promoted to production, inform merge status, mention if CHANGELOG.md was updated and any necessary follow-ups.
   - **Highlight**: Clearly inform that changes are now in production (`origin/main`).
   - Update `.cursor/HANDOFF.md` ("promoted to production"); if appropriate, memory-loop WRITE.

---

## Naming: `staging`, `homologacao` and migration

- **Canonical:** `staging` (i18n, aligned with GitHub/GitLab and other ecosystem projects).
- **Legacy:** old repositories may still have `homologacao`; `git homolog` is accepted as synonym for `git staging` and operates on existing pre-prod branch.
- **Migration:** create `staging` from `homologacao` (`git checkout homologacao && git checkout -b staging && git push -u origin staging`), update branch protection and open MRs, then retire `homologacao`.
- **Production** is deploy/CI *environment*, not mandatory branch name — `main` remains the destination for `git prod`.
