# Git prod

Siga a rotina **git prod** para promover `origin/staging` para `origin/main` (produção):

1. **Leia** a seção "Prompt: git prod" em `autogit/gitupdate.md` (quando existir no projeto).
2. Validação crítica: sem alterações locais não commitadas; nunca commit direto em main.
3. Feche a release no CHANGELOG (mover `[Unreleased]` → versão datada) antes do merge.
4. Mostre o resumo das mudanças (diff/log) entre staging e main e **peça confirmação explícita** ao usuário antes de merge e push para main.
5. Execute merge → main, push main, confirme produção.
6. Atualize `.cursor/HANDOFF.md` ("promovido a produção") e, se couber, memory-loop WRITE.
7. Neste monorepo: após prod, sync público conforme `autogit/gitupdate.md` / `pnpm git:trigger-public-sync` quando aplicável.
