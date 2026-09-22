---
name: kit-prod
description: Run the git-prod routine, then update and promote the public landing only when this promotion includes a product release.
---

# Kit prod

Wraps native **git prod**. Does not replace `/git-prod`. Native `/git-prod` promotes the repo (`staging` → `main`, tag, npm) and must not put the landing on the air by itself. This bundle may promote the landing after git prod, only when a release changelog actually changed.

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default.

## 1. Git prod HITL (do not steal)

Follow the **Prompt: git prod** section in `autogit/gitupdate.md` and `.cursor/commands/git-prod.md`. Do not copy that routine into this file.

Before merge or push to `main`, Ask questions with the **same** git-prod labels. Do not rename them, skip them, or fold landing into this Ask.

Options: `Proceed with production deploy` / `Review changes first` / `Cancel`

**Fallback (path 1):** if Ask questions is missing, say so once, print the same labels as one numbered list, accept number or label, and treat a typed answer as Other. Do not invent a fake tool call. Wait.

`Cancel` or skipped: stop. No merge, no landing.

`Review changes first`: stop after the summary; wait for a later confirm.

`Proceed with production deploy`: continue the git-prod routine (close release, agent signature gate, merge, authorized main push, tag, **mandatory** staging FF sync, public sync, post-prod verification). **One confirm, one ship:** that yes covers one SemVer close, one `v*` tag, one promote; a red or stale public sync (gitupdate step 12.5, including a red `sync-landing`) is a STOP, not a license for another patch under the same yes. **Done** is that step: private `main`, npm, the merged public sync PR, and public Release Latest all name the same tag. The agent signature gate is a hard stop before merge: `git log origin/main..origin/staging --format=%B | sh git-hooks/prepare-commit-msg --check -` (and the staging→main PR body when one exists); exit 1 means the fix goes through `/git-staging` first, never merge over it.

## 2. Decide whether landing work applies

Only after git prod **succeeds**. Landing scripts must exist (`pnpm landing:promote`).

Run `node scripts/kit-landing-gate.mjs --mode prod`. Same rules if the script is missing:

**Run the landing path when:**

- This promotion closed a CHANGELOG version (moved `[Unreleased]` to `## [X.Y.Z]`) or cut a product `v*` tag / manifest bump.
- `scripts/lib/public-changelog.mjs` `extractPublicReleaseNotes` / `latestClosedPublicRelease` has product-facing bullets, not only kit-memory monitors.

**Skip landing (do not Ask a second time) when any of:**

- Git prod did not run (`Cancel` / `Review changes first`).
- No landing scripts in `package.json`.
- No product release changelog in this promotion (`docs(memory):` / `chore(kit):` only).
- The gate prints `"needed": false`.

Repo-only production stays native `/git-prod`.

## 3. Landing after git prod

Release-field sync (version pill + public notes) is private tag CI job `sync-landing`: public excerpt blurb, stamp, staging hop, promote the same `dist/`. Fail-closed if public Release Latest does not match or live HTML stays stale. Do not Ask `Promote landing to production` when that job will run.

Landing Ask is post-default (after git prod, and only when needed). Ask remains for Design-canvas / visual landing deploys, or when `sync-landing` is skipped (no `HOSTINGER_API_TOKEN`). This Ask is **in addition to** the git-prod Ask. Fallback is **path 1**: numbered list, wait; skip or cancel means stop. Do not invent a fake tool call.

Options:

- `Promote landing to production`
- `Skip landing (repo only)`
- `Cancel`

`Cancel` or skipped: stop. Repo is already on `main`; do not revert git prod.

`Skip landing (repo only)`: stop. Report skipped.

`Promote landing to production`: continue (staging hop still required; never rebuild on promote).

## 4. Surgical update + promote (this monorepo)

Do not hand-edit landing markup, CSS, or JS. Do not invent a second updater. The only stamp is `pnpm landing:update-release` (`scripts/update-landing-release.mjs`).

**Fields stamped** (existing canvas nodes, not a second render path):

- Version: `a[data-release-version]` inside `p.ak-brand` (pill "New release") becomes text `Mission Kit X.Y.Z`, href `https://github.com/agent-kit-startup/agent-kit/releases/tag/vX.Y.Z` (public repo only).
- Notes: `div[data-changelog-content]` becomes a short public blurb in a single `<p>`.

**Fail-closed (do not pass these):** `CHANGELOG.md` as `--notes-file`; Keep-a-Changelog headers (`## [`); empty notes; notes over 1200 characters; private `agent-kit-dev` release URLs.

**Sync trap:** `landing:sync` overwrites `remote/` wholesale. Re-run `landing:update-release` after every Design zip or `landing:build:check` fails.

1. **Public excerpt.** `node scripts/public-changelog.mjs --version <X.Y.Z> --blurb` (stdout = `publicNotesBlurb` for `--notes`). `--json` `notes` is GitHub Release body; `publicNotesBlurb` is landing. Gate `stamp.notes` is the same blurb. Never flatten by hand.
2. **Stamp (does not deploy).** Exact CLI:

```bash
NOTES=$(node scripts/public-changelog.mjs --version <X.Y.Z> --blurb)
pnpm landing:update-release -- --version <X.Y.Z> --notes "$NOTES"
pnpm landing:update-release -- --version <X.Y.Z> --notes-file ./public-release-notes.txt
pnpm landing:update-release -- --version <X.Y.Z> --notes "$NOTES" --dry-run
```

Version is the closed release / `stamp.version`. Optional `--dry-run` first.
3. **Build.** `pnpm landing:build` so `dist/` matches the stamp. This is the field-update step, not promote.
4. **Staging hop, then promote.** `pnpm landing:deploy:staging`, confirm staging HTML has the version pill, then `pnpm landing:promote` (same `dist/`; the promote script itself must not rebuild). Do not use `landing:deploy:staging` as a substitute for promote.
5. Update `.cursor/HANDOFF.md` ("promoted to production"; landing URL if promoted).

Never run the landing half from `/run-plan` or `/run-plan-all`. Those commands must not steal `/git-prod` HITL.
