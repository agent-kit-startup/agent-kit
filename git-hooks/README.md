# Git hooks

Local guards for the DevOps spine (staging -> prod flow). Git doesn't version `.git/hooks/`, so each clone needs to install.

## Hooks

| Hook | What it does |
|------|--------------|
| `pre-commit` | Aborts direct commit to `main`/`master` first. Then, if `.cursor/hooks/pre-commit/` exists, runs `validate-all-json.sh` then `check-secrets.sh`. Work goes to a working branch or `staging`. |
| `pre-push` | Aborts direct push to `main`/`master` on any remote, unless `ALLOW_MAIN_PUSH=1` (used by `/git-prod`). Also aborts force-update or delete of `refs/tags/v*` unless `ALLOW_TAG_FORCE=1`. |
| `prepare-commit-msg` | Removes the `Co-authored-by: Cursor` trailer from commit message. |

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

## Emergency override

When really necessary (rare), skip all hooks once:

```sh
git commit --no-verify
git push --no-verify
```
