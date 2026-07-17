#!/usr/bin/env sh
# Valida integridade de workflows n8n após edição (nodes, connections, credentials).
# Uso: validate-n8n.sh <workflow.json> [workflow2.json ...]
# Exit: 0 ok, 1 erro de validação, 2 uso

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../lib/n8n-checker.js"

if [ ! -f "$LIB" ]; then
  echo "Checker não encontrado: $LIB"
  exit 2
fi

if [ $# -eq 0 ]; then
  echo "Uso: validate-n8n.sh <workflow.json> [workflow2.json ...]"
  exit 2
fi

node "$LIB" "$@"
