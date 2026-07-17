# Dicas — comandos nativos do Cursor (3.0+)

## `/worktree`

Comando **nativo** do Cursor para trabalhar num **git worktree** isolado (cópia do repo em outro diretório, mesmo repositório). Útil para experimentos ou homologação sem bloquear a branch em que você está editando. **Não** é preciso implementar um comando custom no Agent Kit.

## `/best-of-n`

Comando **nativo** para gerar e **comparar em paralelo** várias respostas (modelos ou tentativas) na mesma tarefa. Use quando a escolha da solução for crítica. Também não requer implementação no repositório.

## Relação com `/continuar-plano`

Handoff por arquivo (`.cursor/HANDOFF.md`) continua valendo; `/worktree` e `/best-of-n` são **ferramentas do IDE**, não substitutos do Context Pack.
