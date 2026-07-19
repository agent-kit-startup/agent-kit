#!/usr/bin/env sh
# Detects secret patterns in staged files. Blocks commit if found.
# Usage: called by pre-commit; or check-secrets.sh [file ...]
# Exit: 0 ok, 1 secret detected, 2 usage

set -e

# Files to check: arguments or staged
if [ $# -gt 0 ]; then
  files="$*"
else
  files=$(git diff --cached --name-only 2>/dev/null || true)
fi

if [ -z "$files" ]; then
  exit 0
fi

found=0
for f in $files; do
  [ -f "$f" ] || continue
  case "$f" in
    *.json|*.js|*.ts|*.env)
      # Patterns: sensitive key with long value (possible secret)
      if grep -E '"(password|apiKey|api_key|secret|token|auth)"\s*:\s*"[^"]{12,}"' "$f" 2>/dev/null; then
        echo "Possible secret in: $f"
        found=1
      fi
      ;;
  esac
done

if [ $found -eq 1 ]; then
  echo "Remove secrets before committing. Use environment variables or Credentials."
  exit 1
fi
exit 0
