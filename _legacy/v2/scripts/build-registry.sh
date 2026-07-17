#!/usr/bin/env bash
# Gera skills-registry.json a partir de .cursor/skills.
# Uso: build-registry.sh [diretório-skills] [arquivo-saída]
# Ex.: build-registry.sh                    # usa .cursor/skills no cwd, imprime stdout
#      build-registry.sh .cursor/skills     # usa dir informado, imprime stdout
#      build-registry.sh .cursor/skills agent-kit/skills-registry.json  # grava arquivo

set -e

# Diretório de skills: 1º arg ou .cursor/skills a partir do cwd
SKILLS_DIR="${1:-.cursor/skills}"
OUTPUT_FILE="$2"

# Se SKILLS_DIR é relativo e estamos em agent-kit/scripts, subir para repo root
if [[ ! -d "$SKILLS_DIR" && -d "../.cursor/skills" ]]; then
  SKILLS_DIR="../.cursor/skills"
fi
if [[ ! -d "$SKILLS_DIR" ]]; then
  echo "Erro: diretório não encontrado: $SKILLS_DIR" >&2
  exit 1
fi

# Escapar string para JSON (uma linha)
escape_json() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g'
}

# Extrair campo do frontmatter (primeira ocorrência, uma linha)
get_front() {
  local file="$1"
  local key="$2"
  sed -n '/^---$/,/^---$/p' "$file" | grep -m1 "^${key}:" | sed "s/^${key}: *//" | sed 's/[[:space:]]*$//'
}

# Coletar categorias únicas e skills
declare -a SKILL_NAMES
declare -a SKILL_DESCS
declare -a SKILL_CATS
declare -a SKILL_PATHS
CATS_JSON=""

for dir in "$SKILLS_DIR"/*/; do
  [[ -d "$dir" ]] || continue
  path=$(basename "$dir")
  skill_md="${dir}SKILL.md"
  [[ -f "$skill_md" ]] || continue

  name=$(get_front "$skill_md" "name")
  desc=$(get_front "$skill_md" "description")
  cat=$(get_front "$skill_md" "category")
  [[ -z "$name" ]] && name="$path"
  [[ -z "$desc" ]] && desc=""
  [[ -z "$cat" ]] && cat=""

  SKILL_NAMES+=("$name")
  SKILL_DESCS+=("$desc")
  SKILL_CATS+=("$cat")
  SKILL_PATHS+=("$path")
done

# Categorias únicas (ordenadas)
categories=$(printf '%s\n' "${SKILL_CATS[@]}" | grep -v '^$' | sort -u)
CATS_JSON="["
first_cat=1
while IFS= read -r c; do
  [[ -z "$c" ]] && continue
  [[ $first_cat -eq 0 ]] && CATS_JSON+=","
  CATS_JSON+="\"$(escape_json "$c")\""
  first_cat=0
done <<< "$categories"
CATS_JSON+="]"

# Skills array
SKILLS_JSON="["
for i in "${!SKILL_NAMES[@]}"; do
  [[ $i -gt 0 ]] && SKILLS_JSON+=","
  SKILLS_JSON+=$'\n  {'
  SKILLS_JSON+="\"name\": \"$(escape_json "${SKILL_NAMES[$i]}")\", "
  SKILLS_JSON+="\"description\": \"$(escape_json "${SKILL_DESCS[$i]}")\", "
  SKILLS_JSON+="\"category\": \"$(escape_json "${SKILL_CATS[$i]}")\", "
  SKILLS_JSON+="\"path\": \"$(escape_json "${SKILL_PATHS[$i]}")\""
  SKILLS_JSON+="}"
done
SKILLS_JSON+=$'\n]'

REGISTRY="{
  \"version\": \"1\",
  \"categories\": $CATS_JSON,
  \"skills\": $SKILLS_JSON
}
"

if [[ -n "$OUTPUT_FILE" ]]; then
  echo "$REGISTRY" > "$OUTPUT_FILE"
  echo "Registry gravado: $OUTPUT_FILE" >&2
else
  echo "$REGISTRY"
fi
