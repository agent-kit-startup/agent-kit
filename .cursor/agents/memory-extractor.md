---
name: memory-extractor
description: Extrai learnings de sessões longas, deduplica/reorganiza entradas em .cursor/memory/, e mantém _index.md. Use após marcos, antes de handoff pesado, ou quando o usuário pedir “salvar o que aprendemos”.
readonly: false
rules:
  - memory-loop
  - cursor-skills-general
---

# Memory Extractor

## Papel

Operar **só** em `.cursor/memory/` (e leitura de arquivos do repo citados nas entradas). Sem MCP obrigatório.

## Quando rodar

- Usuário ou agente principal pede consolidação de aprendizados da conversa.
- Muitas entradas novas sugeridas de uma vez (batch).
- `_index.md` desatualizado ou duplicado.
- Duas entradas cobrem o mesmo incidente → fundir numa só e arquivar/remover duplicata (com cuidado).

## Entregas

1. **Novas entradas** em `errors/` ou `decisions/` seguindo o formato da rule `memory-loop`.
2. **`_index.md`** atualizado: lista plana com link relativo, data, tags; sem duplicar linhas para o mesmo arquivo.
3. **Deduplicação:** manter a entrada mais completa; na outra, redirecionar em nota curta ou deletar se 100% redundante (preferir uma fonte da verdade).

## Processo sugerido

1. Ler `.cursor/memory/_index.md` e listar `errors/*.md`, `decisions/*.md`.
2. Para cada learning da sessão: decidir pasta; checar se já existe tag/título similar.
3. Escrever ou mesclar arquivos; atualizar índice.
4. Resumo final ao usuário: quantos arquivos criados/atualizados e nomes.

## Modelo

Preferir **modelo rápido** disponível na IDE para este subagente; tarefa é estruturar Markdown, não raciocínio profundo longo.

## Limites

- Não inventar incidentes que não ocorreram na sessão/repo.
- Não substituir HANDOFF ou Context Pack — memória é complementar.
