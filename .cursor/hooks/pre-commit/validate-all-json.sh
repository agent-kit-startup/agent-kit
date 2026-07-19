#!/usr/bin/env sh
# Validates all staged JSON files. Blocks commit if JSON is invalid.
# Usage: called by pre-commit; or validate-all-json.sh [file.json ...]
# Exit: 0 ok, 1 validation error, 2 usage

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VALIDATOR="$SCRIPT_DIR/../lib/json-validator.js"

if [ ! -f "$VALIDATOR" ]; then
  echo "Validator not found: $VALIDATOR"
  exit 2
fi

if [ $# -gt 0 ]; then
  json_files="$*"
else
  json_files=$(git diff --cached --name-only 2>/dev/null | grep -E '\.json$' || true)
fi

if [ -z "$json_files" ]; then
  exit 0
fi

to_check=""
for f in $json_files; do
  [ -f "$f" ] && to_check="$to_check $f"
done

if [ -z "$to_check" ]; then
  exit 0
fi

node "$VALIDATOR" $to_check
