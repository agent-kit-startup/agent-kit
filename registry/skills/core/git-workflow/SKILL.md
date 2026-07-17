---
name: Git Workflow
description: Git Workflow skill.
version: 0.1.0
category: core
---

# Git Workflow

Two-step promote: **staging → production**. Never commit directly to `main`.

## Commands

| User says | Slash | Effect |
|-----------|-------|--------|
| `git staging` (legacy: `git homolog`) | `/git-staging` | Local → `staging` branch (legacy repos may use `homologacao`) |
| `git prod` | `/git-prod` | `staging` → `main` (explicit confirmation) |

Spec: `autogit/gitupdate.md` when present in the project.

## Agent memory loop

```
plan → /handoff → /git-staging → (approval) → /git-prod → memory-loop WRITE if needed
```

After each promote, update `.cursor/HANDOFF.md`. Conventional Commits. Prefer `/worktree` for risky experiments.
