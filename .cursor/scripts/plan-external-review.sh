#!/usr/bin/env bash
# plan-external-review.sh - opt-in launcher for post-hoc Claude Code plan review (audits).
#
# ADR: .cursor/memory/decisions/2026-07-20_optional-claude-code-plan-review.md
# Autonomous audits: .cursor/memory/decisions/2026-07-27_audits-autonomous-plan-review-contract.md
# Chat vs CI honesty: .cursor/memory/decisions/2026-07-25_external-review-chat-visible-vs-ci-headless.md
# Headless/background PTY: .cursor/memory/decisions/2026-07-28_audits-headless-terminal-honesty.md
# Hard constraints:
#   - No Cursor native `stop` hook (see stop-hook-no-hitl-interference)
#   - Not the full --backend claude tick runner
#   - Opt-in via .cursor/context/config.json externalPlanReview.enabled (default false)
#   - If claude missing: tip + exit 0 (do not fail the plan run); Field Report stays owed
#   - Never silent agent-shell `claude -p` claimed as a chat audit (honesty invariant)
#   - Never /git-prod; never broad git add
#
# Canonical path: .cursor/scripts/plan-external-review.sh
# Compatibility wrapper: scripts/plan-external-review.sh
#
# Usage:
#   .cursor/scripts/plan-external-review.sh [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --autonomous [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --paste-only [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --interactive [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --print [plan-file.plan.md]   # CI / headless
#   .cursor/scripts/plan-external-review.sh --force [plan-file.plan.md]   # CI/headless one-shot
#   .cursor/scripts/plan-external-review.sh --force --paste-only [plan]   # legacy chat fallback
#   .cursor/scripts/plan-external-review.sh --force --interactive [plan]  # already in YOUR terminal
#   .cursor/scripts/plan-external-review.sh --force --autonomous --batch p1.plan.md p2.plan.md
#   .cursor/scripts/plan-external-review.sh --dry-run [plan-file.plan.md]
#   .cursor/scripts/plan-external-review.sh --force --autonomous --wait-monitor [plan]
#   .cursor/scripts/plan-external-review.sh --wait-monitor [--wait-timeout SECONDS] [plan]
#   .cursor/scripts/plan-external-review.sh --focus-terminal ...          # rollback: OS window focus
#
# Modes:
#   autonomous (config mode=autonomous, or --autonomous): spawn interactive Claude in an
#     inspectable background/headless PTY (tmux/screen preferred; macOS Terminal do-script
#     without activate; Linux/Windows emulator as last resort). Soft-falls back to
#     --paste-only when background spawn is unavailable. Never agent-shell claude -p.
#   --paste-only: print + clipboard a ready-to-paste interactive command; never claim review ran.
#   --interactive: start interactive `claude` in the *current* shell (must be the user's terminal).
#   --print / headless: non-interactive `claude -p` (CI / agent-kit run-plan only).
#   Default with no mode flag: if config mode is autonomous and env is not headless -> autonomous;
#     otherwise print (legacy / CI). Missing config mode key => paste-compatible (print default).
#   --batch: review multiple plan basenames in one Claude session (mid-batch + queue-end arms).
#   --force / -f: skip config_enabled gate (does not persist opt-in).
#   --dry-run: resolve mode/plan and print launch strategy; do not spawn Claude.
#   --focus-terminal / AGENT_KIT_AUDIT_FOCUS_TERMINAL=1: rollback to OS Terminal activate /
#     emulator focus (legacy foreground window). Default is no-focus background spawn.
#   --wait-monitor: after autonomous spawn (or standalone), poll until plan-monitor-<slug>.md
#     is fresh under .cursor/memory/, or until --wait-timeout (default 900s).
#     Fresh = mtime >= arm epoch (recorded when wait arm starts) OR file contains
#     the content sentinel line: <!-- audits-wait-fresh: created -->
#     Pre-arm / stale files are ignored (do not exit 0 on existence alone).
#     Combine with --force --autonomous (spawn then wait), or use alone to poll an
#     already-running review. Does not switch to invisible agent-shell claude -p.
#   --wait-timeout SECONDS: poll budget for --wait-monitor (default 900).
#
# Exit codes:
#   0  ok / fresh monitor ready (with --wait-monitor) / soft-fail tip when NOT waiting
#      (missing claude/template: tip + exit 0 when --wait-monitor is off)
#   2  usage / argument error
#   3  --wait-monitor timeout (no fresh monitor within budget)
#   4  soft-fail while --wait-monitor was requested (e.g. missing claude on autonomous
#      arm, or background spawn fell back to paste-only without a waitable arm)
#
# Freshness ADR: .cursor/memory/decisions/2026-07-27_audits-wait-freshness-enforce.md
# Background PTY ADR: .cursor/memory/decisions/2026-07-28_audits-headless-terminal-honesty.md

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/.cursor/context/config.json"
TEMPLATE_REL=".cursor/context/templates/plan-external-review-prompt.md"
HANDOFF_REL=".cursor/HANDOFF.md"
PLANS_DIR="$ROOT/.cursor/plans"
LAUNCHER_REL=".cursor/scripts/plan-external-review.sh"

MODE="" # print | paste-only | interactive | autonomous (resolved after flags + config)
MODE_EXPLICIT=0
CLAUDE_PERMISSION_MODE="auto"
FORCE=0
BATCH=0
DRY_RUN=0
WAIT_MONITOR=0
WAIT_TIMEOUT=900
WAIT_ARM_EPOCH=""
FOCUS_TERMINAL=0
# Set by launch_background_terminal on success: tmux|screen|macos-terminal|linux-emulator|windows-terminal
LAUNCH_CHANNEL=""
LAUNCH_ATTACH_HINT=""
PLAN_ARG=""
PLAN_ARGS=()

if [[ "${AGENT_KIT_AUDIT_FOCUS_TERMINAL:-}" == "1" || "${AGENT_KIT_AUDIT_FOCUS_TERMINAL:-}" == "true" ]]; then
  FOCUS_TERMINAL=1
fi

usage() {
  sed -n '2,70p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --paste-only|--paste)
      MODE="paste-only"
      MODE_EXPLICIT=1
      shift
      ;;
    --interactive|-i)
      MODE="interactive"
      MODE_EXPLICIT=1
      shift
      ;;
    --autonomous|--auto-launch)
      MODE="autonomous"
      MODE_EXPLICIT=1
      shift
      ;;
    --print|-p|--headless)
      MODE="print"
      MODE_EXPLICIT=1
      shift
      ;;
    --force|-f)
      FORCE=1
      shift
      ;;
    --batch)
      BATCH=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --wait-monitor)
      WAIT_MONITOR=1
      shift
      ;;
    --focus-terminal)
      FOCUS_TERMINAL=1
      shift
      ;;
    --wait-timeout)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "error: --wait-timeout requires SECONDS" >&2
        exit 2
      fi
      if ! [[ "$2" =~ ^[1-9][0-9]*$ ]]; then
        echo "error: --wait-timeout must be a positive integer (got: $2)" >&2
        exit 2
      fi
      WAIT_TIMEOUT="$2"
      shift 2
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
      PLAN_ARGS+=("$1")
      if [[ -z "$PLAN_ARG" ]]; then
        PLAN_ARG="$1"
      fi
      shift
      ;;
  esac
done

# Trailing args after options (batch lists).
while [[ $# -gt 0 ]]; do
  PLAN_ARGS+=("$1")
  if [[ -z "$PLAN_ARG" ]]; then
    PLAN_ARG="$1"
  fi
  shift
done

tip_enable() {
  cat <<EOF
tip: audits (external plan review) are opt-in and currently disabled (or config missing).
  1. Copy .cursor/context/config.example.json -> .cursor/context/config.json (if needed)
  2. Set externalPlanReview.enabled to true
  3. Prefer mode: "autonomous" for background/inspectable auto-launch (no paste)
  4. Re-run: $LAUNCHER_REL
  One-shot autonomous: $LAUNCHER_REL --force --autonomous
  Legacy paste fallback: $LAUNCHER_REL --force --paste-only
  Focus Terminal rollback: $LAUNCHER_REL --force --autonomous --focus-terminal
  Manual fallback: /plan-external-review
EOF
}

tip_no_claude() {
  cat <<EOF
tip: 'claude' not found on PATH. Audit skipped (no-op; Field Report stays owed).
  Install Claude Code CLI, then re-run: $LAUNCHER_REL --force --autonomous
  Or use paste fallback: $LAUNCHER_REL --force --paste-only
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

# Prints "autonomous" | "paste" | "". Missing key / file => "" (legacy paste-compatible).
config_review_mode() {
  if [[ ! -f "$CONFIG" ]]; then
    echo ""
    return
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      try {
        const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const m = j && j.externalPlanReview && j.externalPlanReview.mode;
        process.stdout.write(m === "autonomous" || m === "paste" ? m : "");
      } catch {
        process.stdout.write("");
      }
    ' "$CONFIG"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$CONFIG" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        j = json.load(f)
    m = j.get("externalPlanReview", {}).get("mode")
    print(m if m in ("autonomous", "paste") else "", end="")
except Exception:
    pass
PY
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    local m
    m="$(jq -r '.externalPlanReview.mode // empty' "$CONFIG" 2>/dev/null || true)"
    if [[ "$m" == "autonomous" || "$m" == "paste" ]]; then
      echo "$m"
    else
      echo ""
    fi
    return
  fi
  echo ""
}

# Prints "true" or "false". Missing key => false (queue-end / owed ledger for paste installs).
config_mid_batch_audits() {
  if [[ ! -f "$CONFIG" ]]; then
    echo "false"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      try {
        const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const v = j && j.externalPlanReview && j.externalPlanReview.midBatchAudits === true;
        process.stdout.write(v ? "true" : "false");
      } catch {
        process.stdout.write("false");
      }
    ' "$CONFIG"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$CONFIG" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        j = json.load(f)
    print("true" if j.get("externalPlanReview", {}).get("midBatchAudits") is True else "false")
except Exception:
    print("false")
PY
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    local v
    v="$(jq -r '.externalPlanReview.midBatchAudits // false' "$CONFIG" 2>/dev/null || echo false)"
    if [[ "$v" == "true" ]]; then
      echo "true"
    else
      echo "false"
    fi
    return
  fi
  echo "false"
}

# Headless CI / agent-kit run-plan: keep claude -p even when config mode is autonomous.
is_headless_env() {
  [[ -n "${AGENT_KIT_HEADLESS:-}" ]] && return 0
  [[ "${CI:-}" == "true" || "${CI:-}" == "1" ]] && return 0
  [[ -n "${GITHUB_ACTIONS:-}" ]] && return 0
  [[ -n "${GITLAB_CI:-}" ]] && return 0
  return 1
}

resolve_launch_mode() {
  if [[ "$MODE_EXPLICIT" -eq 1 && -n "$MODE" ]]; then
    return
  fi
  local cfg_mode
  cfg_mode="$(config_review_mode)"
  if [[ "$cfg_mode" == "autonomous" ]] && ! is_headless_env; then
    MODE="autonomous"
  else
    # Missing mode / paste / headless: legacy print (CI + paste-compatible installs).
    MODE="print"
  fi
}

# Escape a string for embedding inside an AppleScript double-quoted literal.
applescript_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# Spawn interactive Claude in an inspectable background PTY (or focused Terminal when
# --focus-terminal / AGENT_KIT_AUDIT_FOCUS_TERMINAL). Never agent-shell claude -p.
# Sets LAUNCH_CHANNEL + LAUNCH_ATTACH_HINT on success. Returns 0 on success.
# ADR: decisions/2026-07-28_audits-headless-terminal-honesty.md
launch_background_terminal() {
  local shell_cmd="$1"
  local uname_s session_name
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  LAUNCH_CHANNEL=""
  LAUNCH_ATTACH_HINT=""
  session_name="agent-kit-audit-$$"

  # Prefer detached multiplexers (true headless/inspectable PTY, no OS window focus).
  if [[ "$FOCUS_TERMINAL" -eq 0 ]] && command -v tmux >/dev/null 2>&1; then
    if tmux new-session -d -s "$session_name" bash -lc "$shell_cmd" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="tmux"
      LAUNCH_ATTACH_HINT="tmux attach -t $session_name"
      return 0
    fi
  fi
  if [[ "$FOCUS_TERMINAL" -eq 0 ]] && command -v screen >/dev/null 2>&1; then
    if screen -dmS "$session_name" bash -lc "$shell_cmd" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="screen"
      LAUNCH_ATTACH_HINT="screen -r $session_name"
      return 0
    fi
  fi

  # macOS Terminal.app: default without activate (no focus steal); --focus-terminal adds activate.
  if [[ "$uname_s" == "Darwin" ]] && command -v osascript >/dev/null 2>&1; then
    local esc
    esc="$(applescript_escape "$shell_cmd")"
    if [[ "$FOCUS_TERMINAL" -eq 1 ]]; then
      if osascript <<EOF
tell application "Terminal"
  activate
  do script "$esc"
end tell
EOF
      then
        LAUNCH_CHANNEL="macos-terminal"
        LAUNCH_ATTACH_HINT="Terminal.app (focused)"
        return 0
      fi
    else
      if osascript <<EOF
tell application "Terminal"
  do script "$esc"
end tell
EOF
      then
        LAUNCH_CHANNEL="macos-terminal"
        LAUNCH_ATTACH_HINT="Terminal.app window (no activate; may open in background)"
        return 0
      fi
    fi
  fi

  # Linux / Windows emulators (may open a window; last resort before paste-only).
  if command -v gnome-terminal >/dev/null 2>&1; then
    if gnome-terminal -- bash -lc "$shell_cmd; exec bash" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="linux-emulator"
      LAUNCH_ATTACH_HINT="gnome-terminal"
      return 0
    fi
  fi
  if command -v konsole >/dev/null 2>&1; then
    if konsole -e bash -lc "$shell_cmd; exec bash" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="linux-emulator"
      LAUNCH_ATTACH_HINT="konsole"
      return 0
    fi
  fi
  if command -v xfce4-terminal >/dev/null 2>&1; then
    if xfce4-terminal -e "bash -lc $(printf '%q' "$shell_cmd; exec bash")" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="linux-emulator"
      LAUNCH_ATTACH_HINT="xfce4-terminal"
      return 0
    fi
  fi
  if command -v x-terminal-emulator >/dev/null 2>&1; then
    if x-terminal-emulator -e bash -lc "$shell_cmd; exec bash" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="linux-emulator"
      LAUNCH_ATTACH_HINT="x-terminal-emulator"
      return 0
    fi
  fi
  if command -v wt.exe >/dev/null 2>&1; then
    if wt.exe new-tab -- bash -lc "$shell_cmd" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="windows-terminal"
      LAUNCH_ATTACH_HINT="Windows Terminal tab"
      return 0
    fi
  fi

  return 1
}

# Run paste-only UX for $PASTE_CMD / optional $PROMPT / $TRIAGE_PASTE (already set).
emit_paste_only() {
  local kind="${1:-review}"
  copy_to_clipboard "$PASTE_CMD" || true
  cat <<EOF
=== Run ${kind} now (paste fallback / legacy path) ===
The review is NOT running yet. Open a Cursor Terminal in the repo root, then paste:

  $PASTE_CMD

After Claude finishes the monitor(s), paste this triage command (explicit paths; do not use bare /plan-review-triage):

  $TRIAGE_PASTE

--- optional: paste into an already-open \`claude\` session ---
$PROMPT
--- end prompt ---

Autonomous background/inspectable launch was unavailable or --paste-only was requested.
Do not arm silent agent-shell --force/--print from chat (HITL can block invisibly).
CI / headless: $LAUNCHER_REL --force --print   (claude -p; agent-kit run-plan only)
EOF
}

# Prints "true" or "false". Missing config / key / parse failure => false (default).
config_auto_remediate() {
  if [[ ! -f "$CONFIG" ]]; then
    echo "false"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs");
      try {
        const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const v = j && j.externalPlanReview && j.externalPlanReview.autoRemediate === true;
        process.stdout.write(v ? "true" : "false");
      } catch {
        process.stdout.write("false");
      }
    ' "$CONFIG"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$CONFIG" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        j = json.load(f)
    print("true" if j.get("externalPlanReview", {}).get("autoRemediate") is True else "false")
except Exception:
    print("false")
PY
    return
  fi
  if command -v jq >/dev/null 2>&1; then
    local v
    v="$(jq -r '.externalPlanReview.autoRemediate // false' "$CONFIG" 2>/dev/null || echo false)"
    if [[ "$v" == "true" ]]; then
      echo "true"
    else
      echo "false"
    fi
    return
  fi
  echo "false"
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

# Resolve one plan basename/path to absolute path; empty string on failure (no exit).
resolve_one_plan_path() {
  local candidate="$1"
  if [[ -z "$candidate" ]]; then
    echo ""
    return
  fi
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
  echo ""
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
  local auto_remediate="${1:-false}"
  cat <<EOF
Conduct post-hoc external plan review for Agent Kit.

Read and follow: $TEMPLATE_REL
Also read: $PLAN_REL
Also read: $HANDOFF_REL
Git HEAD: $HEAD_SHA
Repo root: $ROOT
autoRemediate (from config): $auto_remediate

Contract reminders:
- Evidence-based monitor only under .cursor/memory/plan-monitor-<slug>.md
- Findings-only: never auto-fix product source; write the monitor and flag residuals for triage
- No product commits unless a human explicitly requests them after /plan-review-triage
- When autoRemediate is false (default): do not apply or suggest starting product edits in this session
- Never /git-prod; never broad git add (add-by-name if staging monitor)
- Index new monitors in .cursor/memory/_index.md (Audits table)
- Closeout: print a ready-to-paste line with explicit paths for every monitor written this session:
  /plan-review-triage .cursor/memory/plan-monitor-<slug>.md
  Never recommend bare /plan-review-triage alone (mtime can miss fresh reviews behind bulk-touched older monitors).
EOF
}

build_batch_prompt() {
  local auto_remediate="${1:-false}"
  local plan_list="$2"
  cat <<EOF
Conduct post-hoc external plan review for Agent Kit (batch / cadence).

Read and follow: $TEMPLATE_REL
Also read: $HANDOFF_REL
Git HEAD: $HEAD_SHA
Repo root: $ROOT
autoRemediate (from config): $auto_remediate

Review each of these plans in one session (write one plan-monitor-<slug>.md per plan):
$plan_list

Contract reminders:
- Evidence-based monitor only under .cursor/memory/plan-monitor-<slug>.md
- Findings-only: never auto-fix product source; write the monitor and flag residuals for triage
- No product commits unless a human explicitly requests them after /plan-review-triage
- When autoRemediate is false (default): do not apply or suggest starting product edits in this session
- Never /git-prod; never broad git add (add-by-name if staging monitor)
- Index new monitors in .cursor/memory/_index.md (Audits table)
- Closeout: print one ready-to-paste line covering every monitor written this session, e.g.
  /plan-review-triage .cursor/memory/plan-monitor-<slug-a>.md .cursor/memory/plan-monitor-<slug-b>.md
  Never recommend bare /plan-review-triage alone (mtime can miss fresh reviews behind bulk-touched older monitors).
EOF
}

# plan basename foo.plan.md -> .cursor/memory/plan-monitor-foo.md
monitor_path_for_plan_base() {
  local base="$1"
  local slug="${base%.plan.md}"
  printf '%s' ".cursor/memory/plan-monitor-${slug}.md"
}

# Soft-fail while waiting: exit 4. Soft-fail without wait: tip already printed, exit 0.
soft_fail_exit() {
  if [[ "$WAIT_MONITOR" -eq 1 ]]; then
    echo "audits: wait-monitor soft-fail (exit 4)"
    exit 4
  fi
  exit 0
}

# File mtime as unix epoch (macOS stat -f %m; Linux stat -c %Y).
file_mtime_epoch() {
  local full="$1"
  if [[ ! -f "$full" ]]; then
    echo 0
    return
  fi
  if stat -f %m "$full" >/dev/null 2>&1; then
    stat -f %m "$full"
  elif stat -c %Y "$full" >/dev/null 2>&1; then
    stat -c %Y "$full"
  else
    echo 0
  fi
}

# Fresh after arm: mtime >= WAIT_ARM_EPOCH, or content sentinel written by this review run.
monitor_is_fresh() {
  local rel="$1"
  local full="$ROOT/$rel"
  if [[ ! -f "$full" ]]; then
    return 1
  fi
  if grep -qE '^<!-- audits-wait-fresh: (created|updated) -->$' "$full" 2>/dev/null; then
    return 0
  fi
  local mtime
  mtime="$(file_mtime_epoch "$full")"
  local epoch="${WAIT_ARM_EPOCH:-0}"
  [[ "$mtime" -ge "$epoch" ]]
}

# Poll until every relative monitor path is fresh under $ROOT, or timeout.
# Prints waiting/created/timeout status lines. Exits 0 (fresh ready) or 3 (timeout).
wait_for_monitors() {
  local paths=("$@")
  if [[ ${#paths[@]} -eq 0 ]]; then
    echo "error: wait_for_monitors requires at least one monitor path" >&2
    exit 2
  fi
  if [[ -z "${WAIT_ARM_EPOCH:-}" ]]; then
    WAIT_ARM_EPOCH="$(date +%s)"
  fi
  local timeout="$WAIT_TIMEOUT"
  local start now elapsed remaining
  start="$(date +%s)"
  echo "audits: wait-monitor waiting (timeout=${timeout}s arm-epoch=${WAIT_ARM_EPOCH})"
  local p
  for p in "${paths[@]}"; do
    if [[ -f "$ROOT/$p" ]] && ! monitor_is_fresh "$p"; then
      echo "  monitor: $p (stale pre-arm; waiting for refresh)"
    else
      echo "  monitor: $p"
    fi
  done
  while true; do
    local missing=0
    for p in "${paths[@]}"; do
      if ! monitor_is_fresh "$p"; then
        missing=1
        break
      fi
    done
    if [[ "$missing" -eq 0 ]]; then
      echo "audits: wait-monitor created"
      for p in "${paths[@]}"; do
        echo "  ready: $p"
      done
      exit 0
    fi
    now="$(date +%s)"
    elapsed=$((now - start))
    if [[ "$elapsed" -ge "$timeout" ]]; then
      echo "audits: wait-monitor timeout after ${elapsed}s (exit 3)"
      for p in "${paths[@]}"; do
        if monitor_is_fresh "$p"; then
          echo "  ready: $p"
        elif [[ -f "$ROOT/$p" ]]; then
          echo "  stale: $p"
        else
          echo "  missing: $p"
        fi
      done
      exit 3
    fi
    remaining=$((timeout - elapsed))
    if [[ $((elapsed % 30)) -eq 0 ]]; then
      echo "audits: wait-monitor still waiting (${elapsed}s elapsed, ${remaining}s left)"
    fi
    sleep 1
  done
}

print_wait_monitor_dry_run() {
  local paths=("$@")
  if [[ "$WAIT_MONITOR" -eq 1 ]]; then
    if [[ -z "${WAIT_ARM_EPOCH:-}" ]]; then
      WAIT_ARM_EPOCH="$(date +%s)"
    fi
    echo "  wait-monitor: yes"
    echo "  wait-timeout: ${WAIT_TIMEOUT}s"
    echo "  wait-arm-epoch: ${WAIT_ARM_EPOCH}"
    echo "  wait-freshness: mtime>=arm-epoch or <!-- audits-wait-fresh: created|updated -->"
    local p
    for p in "${paths[@]}"; do
      echo "  wait-path: $p"
      if [[ -f "$ROOT/$p" ]]; then
        if monitor_is_fresh "$p"; then
          echo "  wait-path-status: fresh (would ready)"
        else
          echo "  wait-path-status: stale-or-pre-arm"
        fi
      else
        echo "  wait-path-status: missing"
      fi
    done
  else
    echo "  wait-monitor: no"
  fi
}

build_triage_paste_line() {
  local paths=("$@")
  if [[ ${#paths[@]} -eq 0 ]]; then
    printf '%s' "/plan-review-triage"
    return
  fi
  local out="/plan-review-triage"
  local p
  for p in "${paths[@]}"; do
    out+=" $p"
  done
  printf '%s' "$out"
}

if [[ "$FORCE" -ne 1 ]]; then
  if ! config_enabled; then
    tip_enable
    exit 0
  fi
fi

HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
AUTO_REMEDIATE="$(config_auto_remediate)"
MID_BATCH_AUDITS="$(config_mid_batch_audits)"
CONFIG_MODE_RAW="$(config_review_mode)"
resolve_launch_mode

if [[ ! -f "$ROOT/$TEMPLATE_REL" ]]; then
  tip_no_template
  soft_fail_exit
fi

# Arm epoch before spawn/poll so pre-existing monitors are not false-ready.
if [[ "$WAIT_MONITOR" -eq 1 && -z "${WAIT_ARM_EPOCH:-}" ]]; then
  WAIT_ARM_EPOCH="$(date +%s)"
fi

# Standalone wait: --wait-monitor with no explicit launch mode (legacy print default)
# polls an already-running review and must not headless-spawn claude -p.
# Explicit --paste-only + --wait-monitor: emit paste tip, then poll (not poll-only).
# Explicit --autonomous + --wait-monitor: background/inspectable spawn, then poll.
POLL_ONLY=0
# Standalone --wait-monitor (no explicit mode flag): poll only, even if config mode is autonomous.
# Spawn-then-wait requires explicit --autonomous (or config-driven run without --wait-monitor alone).
if [[ "$WAIT_MONITOR" -eq 1 && "$MODE_EXPLICIT" -eq 0 ]]; then
  POLL_ONLY=1
  MODE="paste-only"
fi
if [[ "$WAIT_MONITOR" -eq 1 && ( "$MODE" == "interactive" || "$MODE" == "print" ) && "$MODE_EXPLICIT" -eq 1 ]]; then
  echo "tip: --wait-monitor is ignored with --interactive/--print (process is replaced by claude)" >&2
fi

# paste-only / dry-run / poll-only do not require claude on PATH.
if [[ "$MODE" != "paste-only" && "$DRY_RUN" -ne 1 && "$POLL_ONLY" -ne 1 ]]; then
  if ! command -v claude >/dev/null 2>&1; then
    tip_no_claude
    soft_fail_exit
  fi
fi

INTERACTIVE_FLAGS=()
if [[ "$FORCE" -eq 1 ]]; then
  INTERACTIVE_FLAGS+=(--force)
fi
INTERACTIVE_FLAGS+=(--interactive)

if [[ "$BATCH" -eq 1 ]]; then
  if [[ ${#PLAN_ARGS[@]} -eq 0 ]]; then
    echo "error: --batch requires at least one plan file basename" >&2
    exit 2
  fi
  BATCH_BASENAMES=()
  BATCH_RELS=()
  BATCH_LIST=""
  for arg in "${PLAN_ARGS[@]}"; do
    resolved="$(resolve_one_plan_path "$arg")"
    if [[ -z "$resolved" ]]; then
      echo "error: plan file not found: $arg" >&2
      exit 2
    fi
    rel="${resolved#"$ROOT/"}"
    base="$(basename "$rel")"
    BATCH_BASENAMES+=("$base")
    BATCH_RELS+=("$rel")
    BATCH_LIST+="- $rel"$'\n'
  done
  PLAN_REL="${BATCH_RELS[*]}"
  PASTE_CMD="$LAUNCHER_REL ${INTERACTIVE_FLAGS[*]} --batch ${BATCH_BASENAMES[*]}"
  VISIBLE_CMD="cd $(printf '%q' "$ROOT") && $(printf '%q' "$ROOT/$LAUNCHER_REL") ${INTERACTIVE_FLAGS[*]} --batch ${BATCH_BASENAMES[*]}"
  PROMPT="$(build_batch_prompt "$AUTO_REMEDIATE" "$BATCH_LIST")"
  BATCH_MONITOR_PATHS=()
  for base in "${BATCH_BASENAMES[@]}"; do
    BATCH_MONITOR_PATHS+=("$(monitor_path_for_plan_base "$base")")
  done
  TRIAGE_PASTE="$(build_triage_paste_line "${BATCH_MONITOR_PATHS[@]}")"

  echo "audits / external plan review: prepared (batch)"
  echo "  plans: ${BATCH_BASENAMES[*]}"
  echo "  head: $HEAD_SHA"
  echo "  mode: $MODE (config mode: ${CONFIG_MODE_RAW:-missing/legacy})"
  echo "  midBatchAudits: $MID_BATCH_AUDITS"
  echo "  autoRemediate: $AUTO_REMEDIATE"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "  dry-run: yes (no spawn)"
    echo "  background-cmd: $VISIBLE_CMD"
    echo "  paste-cmd: $PASTE_CMD"
    echo "  focus-terminal: $FOCUS_TERMINAL"
    echo "  triage: $TRIAGE_PASTE"
    print_wait_monitor_dry_run "${BATCH_MONITOR_PATHS[@]}"
    exit 0
  fi

  # Poll-only: wait for monitors from an already-running batch review.
  if [[ "$POLL_ONLY" -eq 1 ]]; then
    echo "audits: wait-monitor poll-only (no spawn)"
    wait_for_monitors "${BATCH_MONITOR_PATHS[@]}"
  fi

  echo

  case "$MODE" in
    paste-only)
      emit_paste_only "batch review"
      if [[ "$WAIT_MONITOR" -eq 1 ]]; then
        echo "audits: wait-monitor after paste-only tip (operator must run review elsewhere)"
        wait_for_monitors "${BATCH_MONITOR_PATHS[@]}"
      fi
      exit 0
      ;;
    autonomous)
      echo "audits: starting background/inspectable launch (interactive Claude; no agent-shell -p)..."
      echo "  command: $VISIBLE_CMD"
      if launch_background_terminal "$VISIBLE_CMD"; then
        cat <<EOF
audits: background terminal launched (channel: ${LAUNCH_CHANNEL}).
  attach/inspect: ${LAUNCH_ATTACH_HINT}
Watch that session for Claude HITL; do not claim the audit finished until monitors
exist under .cursor/memory/plan-monitor-*.md. Background PTY is honest; silent
agent-shell claude -p is not. After monitors land, triage with:

  $TRIAGE_PASTE
EOF
        if [[ "$WAIT_MONITOR" -eq 1 ]]; then
          wait_for_monitors "${BATCH_MONITOR_PATHS[@]}"
        fi
        exit 0
      fi
      echo "tip: background auto-launch unavailable; falling back to paste-only."
      emit_paste_only "batch review"
      if [[ "$WAIT_MONITOR" -eq 1 ]]; then
        echo "audits: wait-monitor soft-fail after background-spawn fallback"
        soft_fail_exit
      fi
      exit 0
      ;;
    interactive)
      cd "$ROOT"
      exec claude --permission-mode "$CLAUDE_PERMISSION_MODE" "$PROMPT"
      ;;
    print)
      cd "$ROOT"
      exec claude --permission-mode "$CLAUDE_PERMISSION_MODE" -p "$PROMPT"
      ;;
    *)
      echo "error: internal mode bug: $MODE" >&2
      exit 2
      ;;
  esac
fi

PLAN_PATH="$(resolve_plan)"
PLAN_REL="${PLAN_PATH#"$ROOT/"}"

# Prefer bare plan basename when under .cursor/plans/
PLAN_FOR_CMD="$PLAN_REL"
if [[ "$PLAN_REL" == .cursor/plans/* ]]; then
  PLAN_FOR_CMD="$(basename "$PLAN_REL")"
fi
PASTE_CMD="$LAUNCHER_REL ${INTERACTIVE_FLAGS[*]} $PLAN_FOR_CMD"
VISIBLE_CMD="cd $(printf '%q' "$ROOT") && $(printf '%q' "$ROOT/$LAUNCHER_REL") ${INTERACTIVE_FLAGS[*]} $(printf '%q' "$PLAN_FOR_CMD")"
SINGLE_BASE="$(basename "$PLAN_REL")"
TRIAGE_PASTE="$(build_triage_paste_line "$(monitor_path_for_plan_base "$SINGLE_BASE")")"
PROMPT="$(build_prompt "$AUTO_REMEDIATE")"

echo "audits / external plan review: prepared"
echo "  plan: $PLAN_REL"
echo "  head: $HEAD_SHA"
echo "  mode: $MODE (config mode: ${CONFIG_MODE_RAW:-missing/legacy})"
echo "  midBatchAudits: $MID_BATCH_AUDITS"
echo "  autoRemediate: $AUTO_REMEDIATE"
echo "  permission mode: $CLAUDE_PERMISSION_MODE"
if command -v claude >/dev/null 2>&1; then
  echo "  claude: $(command -v claude)"
else
  echo "  claude: (not on PATH yet)"
fi
SINGLE_MONITOR_PATH="$(monitor_path_for_plan_base "$SINGLE_BASE")"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "  dry-run: yes (no spawn)"
  echo "  background-cmd: $VISIBLE_CMD"
  echo "  paste-cmd: $PASTE_CMD"
  echo "  focus-terminal: $FOCUS_TERMINAL"
  echo "  triage: $TRIAGE_PASTE"
  print_wait_monitor_dry_run "$SINGLE_MONITOR_PATH"
  exit 0
fi

# Poll-only: wait for monitor from an already-running review.
if [[ "$POLL_ONLY" -eq 1 ]]; then
  echo "audits: wait-monitor poll-only (no spawn)"
  wait_for_monitors "$SINGLE_MONITOR_PATH"
fi

echo

case "$MODE" in
  paste-only)
    emit_paste_only "review"
    if [[ "$WAIT_MONITOR" -eq 1 ]]; then
      echo "audits: wait-monitor after paste-only tip (operator must run review elsewhere)"
      wait_for_monitors "$SINGLE_MONITOR_PATH"
    fi
    exit 0
    ;;
  autonomous)
    echo "audits: starting background/inspectable launch (interactive Claude; no agent-shell -p)..."
    echo "  command: $VISIBLE_CMD"
    if launch_background_terminal "$VISIBLE_CMD"; then
      cat <<EOF
audits: background terminal launched (channel: ${LAUNCH_CHANNEL}).
  attach/inspect: ${LAUNCH_ATTACH_HINT}
Watch that session for Claude HITL; do not claim the audit finished until the
monitor exists at:

  $SINGLE_MONITOR_PATH

Background PTY is honest; silent agent-shell claude -p is not. Then triage with:

  $TRIAGE_PASTE
EOF
      if [[ "$WAIT_MONITOR" -eq 1 ]]; then
        wait_for_monitors "$SINGLE_MONITOR_PATH"
      fi
      exit 0
    fi
    echo "tip: background auto-launch unavailable; falling back to paste-only."
    emit_paste_only "review"
    if [[ "$WAIT_MONITOR" -eq 1 ]]; then
      echo "audits: wait-monitor soft-fail after background-spawn fallback"
      soft_fail_exit
    fi
    exit 0
    ;;
  interactive)
    cd "$ROOT"
    # Interactive session in Cursor terminal (user continues the review).
    exec claude --permission-mode "$CLAUDE_PERMISSION_MODE" "$PROMPT"
    ;;
  print)
    cd "$ROOT"
    # Verified Claude Code flag: -p/--print (non-interactive). Do not invent other flags.
    # Headless / CI only. Chat agents must use --autonomous or --paste-only, never silent -p.
    exec claude --permission-mode "$CLAUDE_PERMISSION_MODE" -p "$PROMPT"
    ;;
  *)
    echo "error: internal mode bug: $MODE" >&2
    exit 2
    ;;
esac
