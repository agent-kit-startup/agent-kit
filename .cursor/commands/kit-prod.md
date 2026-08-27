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

**Fallback:** if Ask questions is unavailable, present the same labels as one numbered list and wait.

`Cancel` or skipped: stop. No merge, no landing.

`Review changes first`: stop after the summary; wait for a later confirm.

`Proceed with production deploy`: continue the git-prod routine (close release, merge, authorized main push, tag, public sync, post-prod verification).

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

## 3. Landing HITL (extra confirm)

Ask questions. This Ask is **in addition to** the git-prod Ask, not a replacement. Fallback: numbered list, wait; skip or cancel means stop.

Options:

- `Promote landing to production`
- `Skip landing (repo only)`
- `Cancel`

`Cancel` or skipped: stop. Repo is already on `main`; do not revert git prod.

`Skip landing (repo only)`: stop. Report skipped.

`Promote landing to production`: continue.

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
4. **Promote.** `pnpm landing:promote`. The promote script itself must not rebuild (existing invariant). Do not use `landing:deploy:staging` as a substitute for promote.
5. Update `.cursor/HANDOFF.md` ("promoted to production"; landing URL if promoted).

Never run the landing half from `/run-plan` or `/run-plan-all`. Those commands must not steal `/git-prod` HITL.
