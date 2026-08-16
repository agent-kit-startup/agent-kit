---
name: git-autogit
description: Applies staging → production flow (git staging, git prod), CHANGELOG and Conventional Commits. Dogfood-only: not a pack member; consumers use L0 /git-staging and /git-prod. Optional Task isolation in the kit repo.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-git-workflow
  - cursor-skills-general
---

# Git and Autogit (DevOps spine)

- **Never** commit directly to `main`. Always promote via staging.
- **git staging** (legacy: **git homolog**): development → `origin/staging`.
- **git prod:** approved staging → `origin/main`.
- After each promote: update `.cursor/HANDOFF.md`; if applicable, memory-loop WRITE.
- Messages: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Details: [autogit/gitupdate.md](../../autogit/gitupdate.md). Rule: [cursor-skills-git-workflow.mdc](../rules/cursor-skills-git-workflow.mdc).
- Commands: `/git-staging`, `/git-prod`.
- **Plan-monitor skim:** before promote, warn on dirty untracked `plan-monitor-*.md` and stage memory files add-by-name only. Advisory mention of Blocking untriaged monitors on `/git-prod` is allowed; never steal prod HITL.
