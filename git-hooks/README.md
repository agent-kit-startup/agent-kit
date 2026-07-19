# Git hooks

Local guards for the DevOps spine (staging -> prod flow). Git doesn't version `.git/hooks/`, so each clone needs to install.

## Hooks

| Hook | What it does |
|------|--------------|
| `pre-commit` | Aborts direct commit to `main`/`master`. Work goes to working branch or `staging`. |
| `pre-push` | Aborts direct push to `main`/`master` on any remote. `main` only receives promotes via `git prod`. |
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

## One-time override

When really necessary (rare), skip the guard once:

```sh
git commit --no-verify
git push --no-verify
```
