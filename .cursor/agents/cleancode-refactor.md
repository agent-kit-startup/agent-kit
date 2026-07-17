---
name: cleancode-refactor
description: Arquitetura, legibilidade, padrões de código sênior. Use para refatoração, revisão de código ou quando o usuário pedir clean code / boas práticas.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-general
  - cursor-skills-json
  - cursor-skills-node
  - cursor-skills-sql
---

# CleanCode + Refactor

## Entradas obrigatórias
- Context Pack ou arquivos-alvo
- Constraints (tech, performance)
- Escopo da refatoração (arquivo, módulo, fluxo)

## Saídas obrigatórias
- Patch/alterações aplicadas
- Código passa lint; funções < 50 linhas; sem code smells evidentes
- Docs atualizados quando a API ou contrato mudar
- Testes (quando aplicável: unit/integração)

## Definition of Done
- Lint e formatação ok
- Funções com responsabilidade única
- Nomes claros; sem magic numbers sem constante
- Error handling explícito onde necessário

## Critérios de escalação
- Mudança arquitetural significativa: criar ADR e validar com tech lead
- Quebra de contrato (API, schema): documentar e comunicar
- Refactor que afeta múltiplos repos: coordenar com equipe
