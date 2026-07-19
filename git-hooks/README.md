# Git hooks

Local guards for the DevOps spine (staging -> prod flow). Git doesn't version `.git/hooks/`, so each clone needs to install.

## Hooks

| Hook | What it does |
|------|--------------|
| `pre-commit` | Aborts direct commit to `main`/`master`. Work goes to working branch or `staging`. |
| `pre-push` | Aborts direct push to `main`/`master` on any remote, unless `ALLOW_MAIN_PUSH=1` (used by `/git-prod`). |
| `prepare-commit-msg` | Removes the `Co-authored-by: Cursor` trailer from commit message. |

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

Do **not** set `ALLOW_MAIN_PUSH` for everyday pushes. Accidental `git push origin main` stays blocked.

## Emergency override

When really necessary (rare), skip all hooks once:

```sh
git commit --no-verify
git push --no-verify
```
