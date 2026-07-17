#!/usr/bin/env bash
# Gerador de skill — Agent Kit
# Uso: new-skill.sh <skill-slug> [categoria]
# Ex.: new-skill.sh meu-skill dados
# Cria .cursor/skills/<skill-slug>/SKILL.md com template (When to Use, Process, Conventions, Examples, decision tree, checklist).
# Rodar a partir da raiz do projeto (onde existe .cursor/) ou definir SKILLS_DIR.

set -e

SKILLS_DIR="${SKILLS_DIR:-.cursor/skills}"
SLUG="${1:?Uso: new-skill.sh <skill-slug> [categoria]. Ex.: new-skill.sh excel-reports dados}"
CATEGORY="${2:-}"

# Resolver diretório de skills (cwd ou pai se .cursor estiver no pai)
ROOT="."
if [[ ! -d "$ROOT/.cursor" && -d "$ROOT/../.cursor" ]]; then
  ROOT=".."
fi
SKILLS_ABS="$ROOT/$SKILLS_DIR"
mkdir -p "$SKILLS_ABS/$SLUG"

# Título legível: slug com hífens trocados por espaço (editar depois se quiser)
NAME_LABEL=$(echo "$SLUG" | tr '-' ' ')

# Frontmatter: category só se informado (nova linha real para YAML válido)
FM_CATEGORY=""
[[ -n "$CATEGORY" ]] && FM_CATEGORY=$'\n'"category: $CATEGORY"

cat > "$SKILLS_ABS/$SLUG/SKILL.md" << EOF
---
name: $SLUG
description: [Ação + contexto + critérios. Ex.: Valida e formata arquivos X no contexto Y. Use quando o usuário pedir Z.]$FM_CATEGORY
---

# $NAME_LABEL

## Quando usar

- [Descrever cenários em que o agente deve aplicar esta skill.]
- Evite usar para tarefas complexas com vários passos independentes (prefira subagent nesses casos).

**Decision tree:** Tarefa única e bem delimitada? → skill ou comando. Múltiplos passos e contexto isolado? → subagent.

## Processo / Instruções

1. [Passo 1 — específico e acionável]
2. [Passo 2]
3. [Passo 3]

## Convenções e boas práticas

- [Convenção 1]
- [Convenção 2]
- Manter instruções específicas, acionáveis e focadas.

## Exemplos

### Exemplo 1

[Entrada ou contexto]

\`\`\`
[Saída ou comportamento esperado]
\`\`\`

### Exemplo 2

[Opcional: segundo exemplo]

## Notas importantes

- [Restrição, edge case ou aviso relevante.]

## Checklist de qualidade (antes de finalizar)

- [ ] Descrição segue fórmula: ação + contexto + critérios (evitar "Helps with X").
- [ ] Instruções são específicas e acionáveis.
- [ ] Exemplos cobrem pelo menos um caso de uso real.
- [ ] Nenhuma instrução contradiz outras rules ou skills do projeto.
EOF

echo "Criado: $SKILLS_ABS/$SLUG/SKILL.md"
echo "Edite a descrição e preencha as seções conforme o propósito do skill."
