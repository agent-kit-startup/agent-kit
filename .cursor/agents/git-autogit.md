---
name: git-autogit
description: Aplica fluxo staging → produção (git staging, git prod), CHANGELOG e Conventional Commits. Use para commits, MR, promoção e CHANGELOG. Usa autogit/gitupdate.md. Atualiza HANDOFF após promote.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-git-workflow
  - cursor-skills-general
---

# Git e Autogit (spine DevOps)

- **Nunca** commit direto em `main`. Sempre promover via staging.
- **git staging** (legado: **git homolog**): desenvolvimento → `origin/staging`.
- **git prod:** staging aprovada → `origin/main`.
- Após cada promote: atualizar `.cursor/HANDOFF.md`; se couber, memory-loop WRITE.
- Mensagens: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- Detalhes: [autogit/gitupdate.md](autogit/gitupdate.md). Regra: [cursor-skills-git-workflow.mdc](.cursor/rules/cursor-skills-git-workflow.mdc).
- Commands: `/git-staging`, `/git-prod` (legado: `/git-homolog`).
