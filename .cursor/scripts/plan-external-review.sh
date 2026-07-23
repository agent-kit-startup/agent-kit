#!/usr/bin/env bash
# plan-external-review.sh - opt-in launcher for post-hoc Claude Code plan review.
#
# ADR: .cursor/memory/decisions/2026-07-20_optional-claude-code-plan-review.md
# Hard constraints:
#   - No Cursor native `stop` hook (see stop-hook-no-hitl-interference)
#   - Not the full --backend claude tick runner
#   - Opt-in via .cursor/context/config.json externalPlanReview.enabled (default false)
#   - If claude missing: tip + exit 0 (do not fail the plan run)
#   - Never /git-prod; never broad git add
#
# Canonical path: .cursor/scripts/plan-external-review.sh
# Compatibility wrapper: scripts/plan-external-review.sh
#
# Usage:
#   .cursor/scripts/plan-external-review.sh [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --paste-only [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --interactive [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --print [plan-file.plan.md]   # alias for default launch
#   .cursor/scripts/plan-external-review.sh --force [plan-file.plan.md]   # one-shot; skip config enabled
#
# Default when enabled + claude on PATH: non-interactive `claude -p` (verified CLI flag).
# --paste-only: print ready-to-paste prompt for Cursor terminal.
# --interactive: start interactive `claude` with the prompt (Cursor terminal).
# --force / -f: skip config_enabled gate (one-shot arm; does not persist opt-in).
#               Still tips and exits 0 if claude is missing.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/.cursor/context/config.json"
TEMPLATE_REL=".cursor/context/templates/plan-external-review-prompt.md"
HANDOFF_REL=".cursor/HANDOFF.md"
PLANS_DIR="$ROOT/.cursor/plans"

MODE="print" # print | paste-only | interactive
FORCE=0
PLAN_ARG=""

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --paste-only|--paste)
      MODE="paste-only"
      shift
      ;;
    --interactive|-i)
      MODE="interactive"
      shift
      ;;
    --print|-p)
      MODE="print"
      shift
      ;;
    --force|-f)
      FORCE=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "error: unknown option: $1 (try --help)" >&2
      exit 2
      ;;
    *)
      PLAN_ARG="$1"
      shift
      ;;
  esac
done

tip_enable() {
  cat <<EOF
tip: external plan review is opt-in and currently disabled (or config missing).
  1. Copy .cursor/context/config.example.json -> .cursor/context/config.json (if needed)
  2. Set externalPlanReview.enabled to true
  3. Re-run: .cursor/scripts/plan-external-review.sh
  Manual fallback: /plan-external-review (paste template prompt in Cursor terminal with claude)
EOF
}

tip_no_claude() {
  cat <<EOF
tip: 'claude' not found on PATH. External plan review skipped (no-op).
  Install Claude Code CLI, or use manual fallback: /plan-external-review
  Template: $TEMPLATE_REL
EOF
}

tip_no_template() {
  cat <<EOF
tip: missing $TEMPLATE_REL - external plan review skipped (no-op).
  Kit templates are L0; if this project was installed before they shipped, run:
    agent-kit update --refresh
  Or copy from the kit registry: .cursor/context/templates/
  Manual fallback: /plan-external-review after the template exists
EOF
}

# Returns 0 only when externalPlanReview.enabled === true.
config_enabled() {
  if [[ ! -f "$CONFIG" ]]; then
    return 1
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      try {
        const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.exit(j && j.externalPlanReview && j.externalPlanReview.enabled === true ? 0 : 1);
      } catch {
        process.exit(1);
      }
    ' "$CONFIG"
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$CONFIG" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        j = json.load(f)
    sys.exit(0 if j.get("externalPlanReview", {}).get("enabled") is True else 1)
except Exception:
    sys.exit(1)
PY
    return $?
  fi
  if command -v jq >/dev/null 2>&1; then
    [[ "$(jq -r '.externalPlanReview.enabled // false' "$CONFIG" 2>/dev/null || echo false)" == "true" ]]
    return $?
  fi
  echo "tip: cannot parse $CONFIG (need node, python3, or jq). Treating as disabled." >&2
  return 1
}

resolve_plan() {
  local candidate=""
  if [[ -n "$PLAN_ARG" ]]; then
    candidate="$PLAN_ARG"
  elif [[ -f "$ROOT/$HANDOFF_REL" ]]; then
    # HANDOFF lines look like: - **Plan:** foo.plan.md
    # Portable parse (macOS BSD sed has no reliable multi-expression -nE chain here).
    candidate="$(
      grep -E '^[[:space:]]*-[[:space:]]*\*\*Plan:\*\*|^[[:space:]]*Plan:' "$ROOT/$HANDOFF_REL" \
        | head -n1 \
        | sed -E 's/^[[:space:]]*-[[:space:]]*\*\*Plan:\*\*[[:space:]]*//; s/^[[:space:]]*Plan:[[:space:]]*//' \
        | tr -d '`' \
        | tr -d '\r' \
        | xargs
    )"
  fi

  if [[ -z "$candidate" ]]; then
    echo "error: no plan resolved. Pass a plan file name or set Plan: in .cursor/HANDOFF.md" >&2
    exit 2
  fi

  # Allow bare name, relative path, or absolute path.
  if [[ "$candidate" == /* && -f "$candidate" ]]; then
    echo "$candidate"
    return
  fi
  if [[ -f "$ROOT/$candidate" ]]; then
    echo "$ROOT/$candidate"
    return
  fi
  if [[ -f "$PLANS_DIR/$candidate" ]]; then
    echo "$PLANS_DIR/$candidate"
    return
  fi
  if [[ -f "$PLANS_DIR/$(basename "$candidate")" ]]; then
    echo "$PLANS_DIR/$(basename "$candidate")"
    return
  fi

  echo "error: plan file not found: $candidate" >&2
  exit 2
}

if [[ "$FORCE" -ne 1 ]]; then
  if ! config_enabled; then
    tip_enable
    exit 0
  fi
fi

if ! command -v claude >/dev/null 2>&1; then
  tip_no_claude
  exit 0
fi

PLAN_PATH="$(resolve_plan)"
PLAN_REL="${PLAN_PATH#"$ROOT/"}"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"

if [[ ! -f "$ROOT/$TEMPLATE_REL" ]]; then
  tip_no_template
  exit 0
fi

PROMPT="$(cat <<EOF
Conduct post-hoc external plan review for Agent Kit.

Read and follow: $TEMPLATE_REL
Also read: $PLAN_REL
Also read: $HANDOFF_REL
Git HEAD: $HEAD_SHA
Repo root: $ROOT

Contract reminders:
- Evidence-based monitor only under .cursor/memory/plan-monitor-<slug>.md
- No product commits unless a human explicitly requests them after triage
- Never /git-prod; never broad git add (add-by-name if staging monitor)
- Index new monitors in .cursor/memory/_index.md (Audits table)
EOF
)"

echo "external plan review: enabled"
echo "  plan: $PLAN_REL"
echo "  head: $HEAD_SHA"
echo "  mode: $MODE"
echo "  claude: $(command -v claude)"
echo

case "$MODE" in
  paste-only)
    cat <<EOF
--- paste into Cursor terminal after: claude ---
$PROMPT
--- end prompt ---

Or run: .cursor/scripts/plan-external-review.sh --interactive
Or run: .cursor/scripts/plan-external-review.sh --print
EOF
    exit 0
    ;;
  interactive)
    cd "$ROOT"
    # Interactive session in Cursor terminal (user continues the review).
    exec claude "$PROMPT"
    ;;
  print)
    cd "$ROOT"
    # Verified Claude Code flag: -p/--print (non-interactive). Do not invent other flags.
    exec claude -p "$PROMPT"
    ;;
  *)
    echo "error: internal mode bug: $MODE" >&2
    exit 2
    ;;
esac
