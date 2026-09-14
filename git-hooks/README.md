# Git hooks

Local guards for the DevOps spine (staging -> prod flow). Git doesn't version `.git/hooks/`, so each clone needs to install.

## Hooks

| Hook | What it does |
|------|--------------|
| `pre-commit` | Aborts direct commit to `main`/`master` first. Then, if `.cursor/hooks/pre-commit/` exists, runs `validate-all-json.sh` then `check-secrets.sh`. Work goes to a working branch or `staging`. |
| `pre-push` | Aborts direct push to `main`/`master` on any remote, unless `ALLOW_MAIN_PUSH=1` (used by `/git-prod`). Also aborts force-update or delete of `refs/tags/v*` unless `ALLOW_TAG_FORCE=1`. Also aborts any direct push to the public mirror repo (`agent-kit-startup/agent-kit`), regardless of branch, unless `ALLOW_PUBLIC_PUSH=1` — see "Public repo is humans-only" below. |
| `prepare-commit-msg` | Agent signature guard: removes coding-agent co-author trailers, session-link trailers and "Generated with <agent>" lines (Claude Code, Cursor, Copilot, Codex, Gemini, Devin, Aider, peers) from the commit message. Human `Co-authored-by:` trailers are kept. `--check` scans a message and exits 1 on a match; the `/git-staging` and `/git-prod` routines run it before push and before merge (hard stop). |

## Install matrix

Factory source of truth is this folder (`git-hooks/`). Updating a tracked hook does not change a live `.git/hooks/` copy until reinstall. Reinstall is operator HITL (do not `cp`, `chmod` `.git/hooks/*`, or set `core.hooksPath` from an agent session without that confirm).

| Lane | Source | main/master abort | secrets + JSON |
|------|--------|-------------------|----------------|
| Factory SoT | `git-hooks/pre-commit` via the copy loop or `core.hooksPath git-hooks` | Yes (first) | Yes, when `.cursor/hooks/pre-commit/` exists; skip (exit 0 after the guard) when it does not |
| Alternate | `.cursor/hooks/pre-commit/pre-commit` copied to `.git/hooks/pre-commit` | No | Yes (`validate-all-json.sh` then `check-secrets.sh`). Resolves repo root via `dirname $0/../..`, which breaks under `core.hooksPath git-hooks` |
| CLI generator | `packages/cli/src/generator/git-hooks.ts` | No | Skip if `.git/hooks/pre-commit` already exists; otherwise writes a simpler `rg` scan, not this chain |

Repo root for the factory hook is `git rev-parse --show-toplevel`, so both install methods above resolve `.cursor/hooks/pre-commit/` helpers.

## Install

```sh
for h in pre-commit pre-push prepare-commit-msg; do
  cp "git-hooks/$h" ".git/hooks/$h" && chmod +x ".git/hooks/$h"
done
```

Or point `core.hooksPath` to this folder:

```sh
git config core.hooksPath git-hooks
```

## Agent signature guard (`prepare-commit-msg`)

Coding agents append signatures and session links to commit messages (Claude Code: `Co-Authored-By: Claude ... <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/...`; Cursor: `Co-authored-by: Cursor <cursoragent@cursor.com>`; Copilot, Codex, Devin and peers: their own trailers; plus the `🤖 Generated with Claude Code` footer and `Made with Cursor` lines). A session URL in a commit that reaches a synced or promoted branch is an internal-link leak. `CLAUDE.md` forbids these trailers in prose; this hook is the local enforcement.

The pattern list lives **inside the hook** (`sh git-hooks/prepare-commit-msg --list`), so the single-file copy install below is self-contained and there is one place to extend. Matching is case-insensitive POSIX ERE on agent names, agent mail domains and session hosts, never on the bare `Co-authored-by:` key: a human co-author trailer (GitHub squash attribution, pair programming) survives.

| Mode | Invocation | Effect |
|------|------------|--------|
| Hook (default) | git calls it on every commit (`-m`, editor, `--amend`, merge) | Strips matching lines in place, lists what it removed on stderr, always exits 0. A message made only of trailers becomes empty and git refuses it as usual. |
| Gate | `git log origin/staging..HEAD --format=%B \| sh git-hooks/prepare-commit-msg --check -` (or `--check <file>`) | Exits 1 and prints the offending lines (with line numbers) when a signature or session link is present; exits 0 with an `ok` line otherwise; never writes. Use the same call on a PR body (`gh pr view <N> --json body -q .body`). Run by the `/git-staging` routine before `git push` and before `gh pr merge`, and by `/git-prod` on `git log origin/main..origin/staging --format=%B` before the merge to `main` (`.cursor/commands/git-staging.md` step 5, `git-prod.md` step 5, `autogit/gitupdate.md`). |
| List | `sh git-hooks/prepare-commit-msg --list` | Prints the patterns, one per line. |

Test: `node --test scripts/git-hooks-prepare-commit-msg.test.mjs` (part of `pnpm test:root-node`).

Scope: this strips on the machine where the hook is installed. It does not rewrite history that already carries trailers, and `git commit --no-verify` skips it. An uninstalled hook is covered by the routine gate: `/git-staging` and `/git-prod` run the Gate invocation above as a hard stop before push and before merge, so a trailer that slipped into a commit (no hook installed, `--no-verify`, a commit made elsewhere) is caught before it reaches `staging` or `main`. Both layers are local to the machine running them; there is no server-side check on the private repo, and the public mirror stays clean by construction of the sync commit (`scripts/sync-public.mjs` writes its own message).

## Authorized prod push (`/git-prod`)

After merging `staging` into `main` locally, publish with the env gate (keeps the hook active):

```sh
ALLOW_MAIN_PUSH=1 git push origin main
```

The same form works from the Cursor agent Shell: `agent-kit guard shell` (CLI SoT; thin beforeShellExecution adapter) allows that command when `ALLOW_MAIN_PUSH=1` is present (inline or process env), matching `pre-push`. Bare `git push origin main` stays denied in both places.

**WARNING**: Avoid exporting `ALLOW_MAIN_PUSH=1` in your IDE session or terminal environment (e.g., `export ALLOW_MAIN_PUSH=1`). This disables main-push protection for every subsequent agent Shell command until unset, not just the intended `/git-prod` push. Use the inline prefix form `ALLOW_MAIN_PUSH=1 git push origin main` for authorized single commands only.

Do **not** set `ALLOW_MAIN_PUSH` for everyday pushes. Accidental `git push origin main` stays blocked.

## Immutable `v*` tags

`pre-push` blocks force-updating or deleting `refs/tags/v*` (new tag creates still allowed). Aligns with `autogit/gitupdate.md` §9.5: if tag CI fails after the first push, cut a **new** patch tag rather than rewriting the published one.

Emergency rewrite (rare):

```sh
ALLOW_TAG_FORCE=1 git push --force origin vX.Y.Z
```

**Optional GitHub ruleset (operator):** on the private repo, add a ruleset for `v*` tags with "Restrict deletions" and "Block force pushes" so server-side policy matches the local hook even when `--no-verify` is used.

## Public repo is humans-only (`pre-push` + `agent-kit guard shell`)

Agents ship product changes to the public mirror (`agent-kit-startup/agent-kit`) only through `scripts/sync-public.mjs`, driven by CI (`v*` tag → `sync-public` workflow, or `pnpm git:trigger-public-sync` fallback) — never a direct `git push` / `gh pr create` / `gh pr merge` from an agent shell against that repo. Two local layers enforce this on the machine running them (neither is server-side):

- `pre-push` blocks any push whose remote URL resolves to `agent-kit-startup/agent-kit` (not `-dev`, i.e. not this private repo), regardless of target branch, unless `ALLOW_PUBLIC_PUSH=1`:
  ```sh
  ALLOW_PUBLIC_PUSH=1 git push <public-remote> ...
  ```
  This is independent of the main-branch gate above — pushing to the public repo's `main` still needs `ALLOW_MAIN_PUSH=1` too.
- `agent-kit guard shell` denies `git push` (by URL, `-R`/`--repo`, or a named remote resolved via `git remote -v`) and `gh pr create` / `gh pr merge` when they target that same slug, same `ALLOW_PUBLIC_PUSH=1` escape (rule `public-repo-direct-write`; see `packages/cli/src/invariants/shell-guard.ts`). Deliberately narrow: `gh issue *` (the `/public-issue-triage` command's documented flow) and `gh api` are not covered — named gaps, not silently enforced. This widens the CLI invariants guard beyond its git-only scope (ADR `2026-07-29_cli-invariants-thin-hook-adapters.md`, amended 2026-09-11 for this exception).

**What this does not do:** neither layer is a substitute for GitHub branch protection / CODEOWNERS on the public repo itself, and neither stops a human maintainer from pushing there directly through their own, differently-configured checkout — that stays the operator's call (see the ADR amendment for the current public-ruleset gap: an `Admin` bypass and no CODEOWNERS, confirmed read-only, not flipped by this guard).

## Emergency override

When really necessary (rare), skip all hooks once:

```sh
git commit --no-verify
git push --no-verify
```
