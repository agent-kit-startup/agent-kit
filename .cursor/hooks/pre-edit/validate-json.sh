#!/usr/bin/env sh
# Validates JSON before editing. Optionally creates backup.
# Usage: validate-json.sh [--backup] <file.json> [file2.json ...]
# Exit: 0 ok, 1 validation error, 2 usage

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIB="$SCRIPT_DIR/../lib/json-validator.js"
BACKUP_DIR="$REPO_ROOT/.cursor/context/backups"

do_backup=false
files=""

for arg in "$@"; do
  case "$arg" in
    --backup) do_backup=true ;;
    -*) echo "Unknown option: $arg"; exit 2 ;;
    *) files="$files $arg"
  esac
done

if [ -z "$files" ]; then
  echo "Usage: validate-json.sh [--backup] <file.json> [file2.json ...]"
  exit 2
fi

if [ ! -f "$LIB" ]; then
  echo "Validator not found: $LIB"
  exit 2
fi

for f in $files; do
  if [ ! -f "$f" ]; then
    echo "File not found: $f"
    exit 1
  fi
  if [ "$do_backup" = true ]; then
    mkdir -p "$BACKUP_DIR"
    cp "$f" "$BACKUP_DIR/$(basename "$f").$(date +%Y%m%d%H%M%S).bak"
  fi
done

node "$LIB" $files
