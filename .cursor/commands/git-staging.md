# Git staging

Siga a rotina **git staging** para levar as alterações locais à branch de pré-produção (`origin/staging` neste repo, ou nome configurado no projeto).

1. **Leia** a seção "Prompt: git staging" em `autogit/gitupdate.md` (quando existir).
2. Execute na ordem: validação (não estar em `main`), CHANGELOG (`[Unreleased]`), checkout staging, pull, branch de trabalho, commit Conventional Commits, push, MR/PR, merge, limpeza.
3. **Nunca** commit direto em `main`.
4. Ao concluir: atualize `.cursor/HANDOFF.md` — fase em staging; se couber, memory-loop WRITE.
5. Opcional: status na PM tool do projeto (ClickUp, Jira, …) se MCP estiver configurado.

Sinônimos aceitos do usuário: `git staging`, `/git-staging` e os legados `git homolog`, `/git-homolog`.
