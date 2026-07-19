#!/usr/bin/env sh
# Validates n8n workflow integrity after editing (nodes, connections, credentials).
# Usage: validate-n8n.sh <workflow.json> [workflow2.json ...]
# Exit: 0 ok, 1 validation error, 2 usage

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../lib/n8n-checker.js"

if [ ! -f "$LIB" ]; then
  echo "Checker not found: $LIB"
  exit 2
fi

if [ $# -eq 0 ]; then
  echo "Usage: validate-n8n.sh <workflow.json> [workflow2.json ...]"
  exit 2
fi

node "$LIB" "$@"
