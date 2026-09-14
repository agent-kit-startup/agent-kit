---
name: kit-staging
description: Run the git-staging routine, then update and deploy the public landing to staging only when this change includes a product changelog or release.
---

# Kit staging

Wraps native **git staging**. Does not replace `/git-staging`. Native `/git-staging` stays git-only and must not deploy the landing.

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default.

## 1. Git staging (SoT)

Follow the **Prompt: git staging** section in `autogit/gitupdate.md` (same contract as `/git-staging`). Do not copy that routine into this file.

Also honor `.cursor/commands/git-staging.md` (monitor hygiene, lint evidence, agent signature gate, Evidence-checks merge gate). The agent signature gate is a hard stop: `git log origin/staging..HEAD --format=%B | sh git-hooks/prepare-commit-msg --check -` before push and the same `--check -` on the PR body before merge; exit 1 means fix the message, never merge over it.

## 2. Decide whether landing work applies

Landing steps run only when this repo has `pnpm landing:deploy:staging`. Consumers without those scripts: stop after git staging; report `landing skipped: no-landing-scripts`.

Run `node scripts/kit-landing-gate.mjs --mode staging` (prints `{ needed, reason, stamp }`). Same rules if the script is missing:

**Run the landing path when all of:**

- Git staging completed (merged to `origin/staging`, or the project's pre-prod branch).
- Public `[Unreleased]` has at least one product-facing bullet (CLI, slash commands, dashboard, landing, npm, consumer-visible behavior), after `scripts/lib/public-changelog.mjs` (`toPublicChangelog` / Unreleased section).
- This change is not only a `docs(memory):` / `chore(kit):` monitor, Audits row, or HANDOFF-only commit.

**Skip landing (do not Ask) when any of:**

- No landing scripts in `package.json`.
- `[Unreleased]` was left empty because git staging found no significant product change.
- The only remaining public bullets are kit-memory (plan-monitors, Audits index rows, session HANDOFF).
- The gate prints `"needed": false`.

Repo-only shipping stays native `/git-staging`.

## 3. Landing HITL (only if landing-worthy)

Ask questions. Fallback: one numbered list, wait; skip or cancel means stop.

Options:

- `Deploy landing to staging`
- `Skip landing (repo only)`
- `Cancel`

`Cancel` or skipped: stop. Do not deploy. Git staging already landed; do not revert it.

`Skip landing (repo only)`: stop after git staging. Report skipped.

`Deploy landing to staging`: continue.

## 4. Surgical landing update (this monorepo)

Do not hand-edit landing markup, CSS, or JS. Do not invent a second updater. The only stamp is `pnpm landing:update-release` (`scripts/update-landing-release.mjs`).

**Fields stamped** (existing canvas nodes, not a second render path):

- Version: `a[data-release-version]` inside `p.ak-brand` (pill "New release") becomes text `Mission Kit X.Y.Z`, href `https://github.com/agent-kit-startup/agent-kit/releases/tag/vX.Y.Z` (public repo only).
- Notes: `div[data-changelog-content]` becomes a short public blurb in a single `<p>`.

**Fail-closed (do not pass these):** `CHANGELOG.md` as `--notes-file`; Keep-a-Changelog headers (`## [`); empty notes; notes over 1200 characters; private `agent-kit-dev` release URLs.

**Sync trap:** `landing:sync` overwrites `remote/` wholesale. Re-run `landing:update-release` after every Design zip or `landing:build:check` fails.

1. **Public excerpt.** `node scripts/public-changelog.mjs --version Unreleased --blurb` (stdout = `publicNotesBlurb` for `--notes`). Same field as gate `stamp.notes`. `--json` `notes` is GitHub Release body, not landing. Never flatten by hand. Not Hostinger tokens, not CI internals, not plan-monitor notes.
2. **Stamp (does not deploy).** Exact CLI:

```bash
NOTES=$(node scripts/public-changelog.mjs --version Unreleased --blurb)
pnpm landing:update-release -- --version <X.Y.Z> --notes "$NOTES"
pnpm landing:update-release -- --version <X.Y.Z> --notes-file ./public-release-notes.txt
pnpm landing:update-release -- --version <X.Y.Z> --notes "$NOTES" --dry-run
```

Version is `package.json` / `stamp.version`. Optional `--dry-run` first.
3. **Build, then staging deploy.** `pnpm landing:build`, then `pnpm landing:deploy:staging`. Never `pnpm landing:promote` from this command.
4. Optional: `pnpm landing:verify:staging`.
5. Update `.cursor/HANDOFF.md`. Never `/git-prod` from this command.
