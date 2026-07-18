#!/usr/bin/env bash
# Dispara o job sync-public no GitHub Actions (workflow_dispatch) após git prod.
# Uso: bash scripts/trigger-public-sync-after-prod.sh
# Requisitos: remote "public" (espelho), origin no GitHub, gh autenticado.
# Secret PUBLIC_REPO_TOKEN deve existir no repositório origin (ex.: agent-kit-dev).

set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Not inside a git repository."
  exit 1
}
cd "$root"

if ! git remote get-url public >/dev/null 2>&1; then
  echo "No remote named 'public' — skipping public mirror trigger (single-repo mode)."
  exit 0
fi

# Accept github.com URLs and SSH host aliases (e.g. git@github-agent-kit:owner/repo.git)
pub_url="$(git remote get-url public)"
if [[ "$pub_url" != *"github"* ]]; then
  echo "Remote 'public' is not on GitHub — skipping gh workflow trigger."
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) not found. Install it and run: gh auth login"
  echo "Or trigger manually: Actions → CI → Run workflow → Sync to public repo."
  exit 1
fi

origin_url="$(git remote get-url origin)"
slug_from_url() {
  local url="${1%.git}"
  if [[ "$url" =~ [:/]([^/:]+)/([^/:]+)$ ]]; then
    echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  fi
}

REPO="$(slug_from_url "$origin_url")"
if [[ -z "$REPO" ]]; then
  echo "Could not parse owner/repo from origin URL: $origin_url"
  exit 1
fi

if [[ ! -f .github/workflows/ci.yml ]]; then
  echo "No .github/workflows/ci.yml — skipping."
  exit 0
fi

echo "Triggering sync-public on $REPO (ref main)..."
gh workflow run ci.yml --repo "$REPO" --ref main -f sync_public=true
echo "Queued. Watch: gh run watch -R \"$REPO\""
echo "Or open: https://github.com/${REPO}/actions"
