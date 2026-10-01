#!/usr/bin/env sh
# Detects secret patterns in lines ADDED by the staged diff. Blocks commit if found.
# Usage: called by pre-commit (no arguments; the working tree is never read).
# Exit: 0 ok, 1 secret detected
#
# Token shapes mirror SECRET_PATTERNS (packages/cli/src/invariants/secrets-scan.ts):
# aws-access-key, github-pat, pem-private-key, slack-token, sk-hyphenated-vendor,
# openai-sk, plus the JSON key/value pattern (json-secret-kv). All staged paths are scanned;
# paths are never expanded by the shell, so names with spaces are safe.

set -eu
# pipefail where the shell has it (bash, zsh, recent dash).
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

pattern='AKIA[0-9A-Z]{16}'
pattern="$pattern"'|gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,}'
pattern="$pattern"'|-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----'
pattern="$pattern"'|xox[abposr]-[A-Za-z0-9-]{10,}'
# sk- keys need a non-word char before them, so kebab-case like run-task-in-... passes.
pattern="$pattern"'|(^|[^A-Za-z0-9_])sk-[A-Za-z0-9]{2,12}-[A-Za-z0-9_-]{16,}'
pattern="$pattern"'|(^|[^A-Za-z0-9_])sk-[A-Za-z0-9]{20,}'
pattern="$pattern"'|"(password|apiKey|api_key|secret|token|auth)"[[:space:]]*:[[:space:]]*"[^"]{12,}"'

# --no-ext-diff/--no-textconv: a diff.external or textconv driver must not rewrite what
# is scanned. Added lines are taken by hunk state (after @@), so an added line that
# starts with "++ " is not mistaken for a file header. The last grep reads all input
# (no -q): under pipefail an early exit would SIGPIPE `git diff` and a large diff would pass.
if git diff --cached --no-ext-diff --no-textconv --no-color -U0 --diff-filter=ACMR \
  | awk '/^diff --git /{h=1; next} /^@@/{h=0; next} !h && /^\+/' \
  | grep -E -e "$pattern" >/dev/null; then
  echo "Possible secret in staged changes. Commit blocked."
  echo "Remove secrets before committing. Use environment variables or Credentials."
  exit 1
fi
exit 0
