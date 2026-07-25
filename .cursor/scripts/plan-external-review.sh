#!/usr/bin/env bash
# plan-external-review.sh - opt-in launcher for post-hoc Claude Code plan review.
#
# ADR: .cursor/memory/decisions/2026-07-20_optional-claude-code-plan-review.md
# Chat vs CI: .cursor/memory/decisions/2026-07-25_external-review-chat-visible-vs-ci-headless.md
# Hard constraints:
#   - No Cursor native `stop` hook (see stop-hook-no-hitl-interference)
#   - Not the full --backend claude tick runner
#   - Opt-in via .cursor/context/config.json externalPlanReview.enabled (default false)
#   - If claude missing: tip + exit 0 (do not fail the plan run) for print/interactive
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
#   .cursor/scripts/plan-external-review.sh --force [plan-file.plan.md]   # CI/headless one-shot
#   .cursor/scripts/plan-external-review.sh --force --paste-only [plan]   # chat "Run review now"
#   .cursor/scripts/plan-external-review.sh --force --interactive [plan]  # paste into YOUR terminal
#
# Modes:
#   Default / --print: non-interactive `claude -p` (CI / headless agent-kit run-plan).
#   --paste-only: print + clipboard a ready-to-paste interactive command; never claim review ran.
#   --interactive: start interactive `claude` (must run in the user's Cursor terminal).
#   --force / -f: skip config_enabled gate (does not persist opt-in).
#                 Alone = headless print mode (CI only). Chat MUST use --paste-only or
#                 give the user --interactive to paste; never arm --force alone from chat.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/.cursor/context/config.json"
TEMPLATE_REL=".cursor/context/templates/plan-external-review-prompt.md"
HANDOFF_REL=".cursor/HANDOFF.md"
PLANS_DIR="$ROOT/.cursor/plans"
LAUNCHER_REL=".cursor/scripts/plan-external-review.sh"

MODE="print" # print | paste-only | interactive
CLAUDE_PERMISSION_MODE="auto"
FORCE=0
PLAN_ARG=""

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
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
  3. Re-run: $LAUNCHER_REL
  Chat one-shot (visible): $LAUNCHER_REL --force --paste-only
  Manual fallback: /plan-external-review
EOF
}

tip_no_claude() {
  cat <<EOF
tip: 'claude' not found on PATH. External plan review skipped (no-op).
  Install Claude Code CLI, or use: $LAUNCHER_REL --force --paste-only
  Then paste the printed command in your Cursor terminal after installing claude.
  Manual fallback: /plan-external-review
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

copy_to_clipboard() {
  local text="$1"
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$text" | pbcopy
    echo "clipboard: copied (pbcopy)"
    return 0
  fi
  if command -v xclip >/dev/null 2>&1; then
    printf '%s' "$text" | xclip -selection clipboard
    echo "clipboard: copied (xclip)"
    return 0
  fi
  if command -v xsel >/dev/null 2>&1; then
    printf '%s' "$text" | xsel --clipboard --input
    echo "clipboard: copied (xsel)"
    return 0
  fi
  if command -v clip.exe >/dev/null 2>&1; then
    printf '%s' "$text" | clip.exe
    echo "clipboard: copied (clip.exe)"
    return 0
  fi
  echo "clipboard: unavailable (copy the command below manually)"
  return 1
}

build_prompt() {
  cat <<EOF
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
}

if [[ "$FORCE" -ne 1 ]]; then
  if ! config_enabled; then
    tip_enable
    exit 0
  fi
fi

PLAN_PATH="$(resolve_plan)"
PLAN_REL="${PLAN_PATH#"$ROOT/"}"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"

if [[ ! -f "$ROOT/$TEMPLATE_REL" ]]; then
  tip_no_template
  exit 0
fi

# paste-only does not require claude on PATH (user may install before pasting).
if [[ "$MODE" != "paste-only" ]]; then
  if ! command -v claude >/dev/null 2>&1; then
    tip_no_claude
    exit 0
  fi
fi

INTERACTIVE_FLAGS=()
if [[ "$FORCE" -eq 1 ]]; then
  INTERACTIVE_FLAGS+=(--force)
fi
INTERACTIVE_FLAGS+=(--interactive)
# Prefer bare plan basename when under .cursor/plans/
PLAN_FOR_CMD="$PLAN_REL"
if [[ "$PLAN_REL" == .cursor/plans/* ]]; then
  PLAN_FOR_CMD="$(basename "$PLAN_REL")"
fi
PASTE_CMD="$LAUNCHER_REL ${INTERACTIVE_FLAGS[*]} $PLAN_FOR_CMD"

echo "external plan review: prepared"
echo "  plan: $PLAN_REL"
echo "  head: $HEAD_SHA"
echo "  mode: $MODE"
echo "  permission mode: $CLAUDE_PERMISSION_MODE"
if command -v claude >/dev/null 2>&1; then
  echo "  claude: $(command -v claude)"
else
  echo "  claude: (not on PATH yet)"
fi
echo

case "$MODE" in
  paste-only)
    PROMPT="$(build_prompt)"
    copy_to_clipboard "$PASTE_CMD" || true
    cat <<EOF
=== Run review now (chat path) ===
The review is NOT running yet. Open a Cursor Terminal in the repo root, then paste:

  $PASTE_CMD

After Claude finishes the monitor, run: /plan-review-triage

--- optional: paste into an already-open \`claude\` session ---
$PROMPT
--- end prompt ---

Do not arm headless --force alone from chat (no IDE terminal; HITL can block invisibly).
CI / headless: $LAUNCHER_REL --force   (claude -p; agent-kit run-plan only)
EOF
    exit 0
    ;;
  interactive)
    cd "$ROOT"
    # Interactive session in Cursor terminal (user continues the review).
    exec claude --permission-mode "$CLAUDE_PERMISSION_MODE" "$(build_prompt)"
    ;;
  print)
    cd "$ROOT"
    # Verified Claude Code flag: -p/--print (non-interactive). Do not invent other flags.
    # Headless / CI only. Chat agents must use --paste-only instead.
    exec claude --permission-mode "$CLAUDE_PERMISSION_MODE" -p "$(build_prompt)"
    ;;
  *)
    echo "error: internal mode bug: $MODE" >&2
    exit 2
    ;;
esac
