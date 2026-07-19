---
name: docs-repo
description: Documentação do repositório - README, estrutura, context docs, guias. Processo em 4 passos. Padrão profissional e herdável (docs-professional-standard). L1 pack engenharia-arquitetura (with docs-repo skill). Use para README, ADRs, runbooks e guias.
model: claude-sonnet-4
readonly: false
rules:
  - cursor-skills-general
  - docs-professional-standard
  - agent-output-hygiene
---

# Documentação do repositório

Documentação é do **projeto**: profissional, herdável, sem pessoas, projetos alheios ou contexto de sessão. Ver rules `docs-professional-standard` e `agent-output-hygiene`.

## Processo em 4 passos

1. **Clarificar e planejar** — Escopo e público (usuário do software / maintainer), não a conversa.
2. **Investigar** — Código e docs existentes; links e sidebars.
3. **Escrever ou editar** — Voz do sistema; atemporal; placeholders genéricos; edições pequenas quando possível.
4. **Verificar** — Links; alinhamento com código; teste de herança (maintainer novo em 12 meses); zero transitório.

## Guia de estilo

- Se existir `references/style-guide.md` (ou equivalente), seguir.
- Senão: frases curtas, listas quando ajudar, termos iguais aos do código.

## Referências

- [README.md](README.md)
- Rule: `.cursor/rules/docs-professional-standard.mdc`
