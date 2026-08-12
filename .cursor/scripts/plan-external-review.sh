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
#   .cursor/scripts/plan-external-review.sh --reap-audit-sessions [--dry-run] [plan]
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
# Progress gate (post-spawn PTY activity):
#   A successful spawn is a launch, not a running review. After an autonomous background
#   spawn on a channel that exposes scrollback (tmux capture-pane, screen hardcopy), the
#   launcher polls for the first PTY output before entering the monitor wait. A silent PTY
#   (no non-whitespace scrollback inside the grace window, or a session that vanished) is
#   treated as a failed launch: print the diagnosis, dispose only the session this run
#   spawned, print the paste fallback, then soft-fail instead of burning the remaining
#   --wait-timeout. Channels without a scrollback API (Terminal.app, Linux/Windows
#   emulators) degrade to advisory and proceed to the normal wait.
#
# Session lifecycle (cap, warn, opt-in reap):
#   Kit-owned audit sessions are named agent-kit-audit-<ws8>-<pid>, where <ws8> is an
#   8-hex workspace token derived from the repo ROOT. Cap, warn, count, and opt-in reap
#   only consider sessions owned by THIS workspace (strict pattern match). Legacy
#   unscoped agent-kit-audit-<pid> names and other workspaces' tokens are never counted
#   or disposed by this process (operator may quit them manually). Attached sessions are
#   never counted as pile pressure. At or above the warn threshold it warns and prints
#   the dispose command; at or above the hard cap it refuses to spawn, prints the dispose
#   instructions plus the paste fallback, and soft-fails without entering the monitor wait
#   (no audit starts, Field Report stays owed).
#   Reaping is opt-in (--reap-audit-sessions or AGENT_KIT_AUDIT_REAP=1) and disposes only
#   detached, workspace-owned sessions whose age is at or above AGENT_KIT_AUDIT_REAP_MIN_AGE.
#   Attached sessions are never touched, an unknown age counts as too young to reap, and
#   --dry-run only previews. No pkill, no wildcard kill, nothing outside the owned namespace.
#
# Environment:
#   AGENT_KIT_AUDIT_PROGRESS_TIMEOUT  progress-gate grace window in seconds (default 60).
#                                     0 disables the gate; a non-integer value prints a tip
#                                     and falls back to 60.
#   AGENT_KIT_AUDIT_SESSION_WARN      warn at or above this many detached workspace-owned
#                                     agent-kit-audit-<ws8>-* sessions (default 5). 0 disables
#                                     the warning; a non-integer value prints a tip and falls
#                                     back to 5.
#   AGENT_KIT_AUDIT_SESSION_CAP       refuse to spawn at or above this many detached
#                                     workspace-owned sessions (default 20). 0 disables the
#                                     refusal; a non-integer value prints a tip and falls
#                                     back to 20.
#   AGENT_KIT_AUDIT_REAP_MIN_AGE      age floor in seconds for opt-in reaping (default 3600).
#                                     A non-integer value prints a tip and falls back to 3600.
#   AGENT_KIT_AUDIT_REAP              1/true: same as --reap-audit-sessions (opt-in disposal
#                                     of detached workspace-owned sessions past the age floor).
#   AGENT_KIT_AUDIT_FOCUS_TERMINAL    1/true: rollback to OS Terminal activate / emulator focus.
#
# Exit codes:
#   0  ok / fresh monitor ready (with --wait-monitor) / soft-fail tip when NOT waiting
#      (missing claude/template: tip + exit 0 when --wait-monitor is off)
#   2  usage / argument error
#   3  --wait-monitor timeout (no fresh monitor within budget)
#   4  soft-fail while --wait-monitor was requested (e.g. missing claude on autonomous
#      arm, background spawn fell back to paste-only without a waitable arm, the
#      post-spawn progress gate aborted early on a silent PTY, or the audit-session cap
#      refused the spawn). Without --wait-monitor the same soft-fails stay tip + exit 0.
#
# Freshness ADR: .cursor/memory/decisions/2026-07-27_audits-wait-freshness-enforce.md
# Background PTY ADR: .cursor/memory/decisions/2026-07-28_audits-headless-terminal-honesty.md
# Progress gate ADR: .cursor/memory/decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md

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
# Post-spawn PTY activity gate grace window (seconds). 0 disables.
PROGRESS_TIMEOUT=60
# Kit-owned audit session namespace. Cap/reap only touch workspace-owned names (see token).
AUDIT_SESSION_NS_PREFIX="agent-kit-audit-"
# 8-hex token from ROOT so concurrent workspaces do not share cap/reap scope.
audit_workspace_token() {
  local hash=""
  if command -v shasum >/dev/null 2>&1; then
    hash="$(printf '%s' "$ROOT" | shasum -a 256 2>/dev/null | awk '{print substr($1,1,8)}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    hash="$(printf '%s' "$ROOT" | sha256sum 2>/dev/null | awk '{print substr($1,1,8)}')"
  elif command -v openssl >/dev/null 2>&1; then
    hash="$(printf '%s' "$ROOT" | openssl dgst -sha256 2>/dev/null | awk '{print substr($NF,1,8)}')"
  else
    hash="$(printf '%s' "$ROOT" | cksum 2>/dev/null | awk '{printf "%08x", $1}' | head -c 8)"
  fi
  if ! [[ "$hash" =~ ^[0-9a-f]{8}$ ]]; then
    hash="$(printf '%s' "$ROOT" | cksum 2>/dev/null | awk '{printf "%08x", $1}' | head -c 8)"
  fi
  printf '%s' "$hash"
}
AUDIT_WS_TOKEN="$(audit_workspace_token)"
AUDIT_SESSION_OWNED_PREFIX="${AUDIT_SESSION_NS_PREFIX}${AUDIT_WS_TOKEN}-"
# Detached workspace-owned sessions: warn at or above WARN, refuse to spawn at or above CAP. 0 disables.
AUDIT_SESSION_WARN=5
AUDIT_SESSION_CAP=20
# Age floor (seconds) for opt-in reaping. Younger sessions are left alone even when reaping is on.
AUDIT_REAP_MIN_AGE=3600
# Opt-in destructive disposal (--reap-audit-sessions / AGENT_KIT_AUDIT_REAP). Never the default.
REAP_SESSIONS=0
FOCUS_TERMINAL=0
# Set by launch_background_terminal on success: tmux|screen|macos-terminal|linux-emulator|windows-terminal
LAUNCH_CHANNEL=""
LAUNCH_ATTACH_HINT=""
# Multiplexer session this invocation created (tmux/screen only). Empty for emulator channels.
LAUNCH_SESSION_NAME=""
PLAN_ARG=""
PLAN_ARGS=()

# 0 when name is a strict workspace-owned audit session for THIS ROOT.
is_owned_audit_session() {
  local name="$1"
  # Strict: agent-kit-audit-<8hex>-<digits> and token must match this workspace.
  if [[ "$name" =~ ^agent-kit-audit-([0-9a-f]{8})-([0-9]+)$ ]]; then
    [[ "${BASH_REMATCH[1]}" == "$AUDIT_WS_TOKEN" ]]
    return $?
  fi
  return 1
}

# Build a fresh owned session name for this PID (collision-resistant across workspaces).
make_audit_session_name() {
  printf '%s%s' "$AUDIT_SESSION_OWNED_PREFIX" "$$"
}

if [[ "${AGENT_KIT_AUDIT_FOCUS_TERMINAL:-}" == "1" || "${AGENT_KIT_AUDIT_FOCUS_TERMINAL:-}" == "true" ]]; then
  FOCUS_TERMINAL=1
fi

# Bad env value is advisory, never a hard error: the gate must not break an audit arm.
if [[ -n "${AGENT_KIT_AUDIT_PROGRESS_TIMEOUT:-}" ]]; then
  if [[ "${AGENT_KIT_AUDIT_PROGRESS_TIMEOUT}" =~ ^[0-9]+$ ]]; then
    PROGRESS_TIMEOUT="${AGENT_KIT_AUDIT_PROGRESS_TIMEOUT}"
  else
    echo "tip: AGENT_KIT_AUDIT_PROGRESS_TIMEOUT must be a non-negative integer (got: ${AGENT_KIT_AUDIT_PROGRESS_TIMEOUT}); using ${PROGRESS_TIMEOUT}" >&2
  fi
fi

# Same advisory contract for the session-lifecycle knobs: a bad value tips and falls back.
resolve_int_env() {
  local var_name="$1"
  local fallback="$2"
  local raw="${!var_name:-}"
  if [[ -z "$raw" ]]; then
    printf '%s' "$fallback"
    return 0
  fi
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf '%s' "$raw"
    return 0
  fi
  echo "tip: ${var_name} must be a non-negative integer (got: ${raw}); using ${fallback}" >&2
  printf '%s' "$fallback"
}

AUDIT_SESSION_WARN="$(resolve_int_env AGENT_KIT_AUDIT_SESSION_WARN "$AUDIT_SESSION_WARN")"
AUDIT_SESSION_CAP="$(resolve_int_env AGENT_KIT_AUDIT_SESSION_CAP "$AUDIT_SESSION_CAP")"
AUDIT_REAP_MIN_AGE="$(resolve_int_env AGENT_KIT_AUDIT_REAP_MIN_AGE "$AUDIT_REAP_MIN_AGE")"

if [[ "${AGENT_KIT_AUDIT_REAP:-}" == "1" || "${AGENT_KIT_AUDIT_REAP:-}" == "true" ]]; then
  REAP_SESSIONS=1
fi

usage() {
  sed -n '2,111p' "$0" | sed 's/^# \{0,1\}//'
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
    --reap-audit-sessions)
      REAP_SESSIONS=1
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
# Rejects control characters (including newlines) so shell payloads never enter AppleScript.
applescript_escape() {
  local s="$1"
  if [[ "$s" == *$'\n'* || "$s" == *$'\r'* || "$s" == *$'\0'* ]]; then
    echo "error: applescript_escape refused control characters in payload" >&2
    return 1
  fi
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# Spawn interactive Claude in an inspectable background PTY (or focused Terminal when
# --focus-terminal / AGENT_KIT_AUDIT_FOCUS_TERMINAL). Never agent-shell claude -p.
# Sets LAUNCH_CHANNEL + LAUNCH_ATTACH_HINT (and LAUNCH_SESSION_NAME on tmux/screen)
# on success. Returns 0 on success.
# ADR: decisions/2026-07-28_audits-headless-terminal-honesty.md
launch_background_terminal() {
  local shell_cmd="$1"
  local uname_s session_name
  uname_s="$(uname -s 2>/dev/null || echo unknown)"
  LAUNCH_CHANNEL=""
  LAUNCH_ATTACH_HINT=""
  LAUNCH_SESSION_NAME=""
  session_name="$(make_audit_session_name)"

  # Prefer detached multiplexers (true headless/inspectable PTY, no OS window focus).
  if [[ "$FOCUS_TERMINAL" -eq 0 ]] && command -v tmux >/dev/null 2>&1; then
    if tmux new-session -d -s "$session_name" bash -lc "$shell_cmd" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="tmux"
      LAUNCH_ATTACH_HINT="tmux attach -t $session_name"
      LAUNCH_SESSION_NAME="$session_name"
      return 0
    fi
  fi
  if [[ "$FOCUS_TERMINAL" -eq 0 ]] && command -v screen >/dev/null 2>&1; then
    if screen -dmS "$session_name" bash -lc "$shell_cmd" >/dev/null 2>&1; then
      LAUNCH_CHANNEL="screen"
      LAUNCH_ATTACH_HINT="screen -r $session_name"
      LAUNCH_SESSION_NAME="$session_name"
      return 0
    fi
  fi

  # macOS Terminal.app: never embed shell_cmd in AppleScript. Write a temp runner and
  # pass only the quoted path (closes PLAN_EXTERNAL_REVIEW_APPLESCRIPT_INJECTION class).
  if [[ "$uname_s" == "Darwin" ]] && command -v osascript >/dev/null 2>&1; then
    local cmd_file run_line esc
    cmd_file="$(mktemp "${TMPDIR:-/tmp}/agent-kit-audit-cmd.XXXXXX")" || return 1
    printf '%s\n' "$shell_cmd" >"$cmd_file"
    chmod u+x "$cmd_file" 2>/dev/null || true
    run_line="bash $(printf '%q' "$cmd_file")"
    if ! esc="$(applescript_escape "$run_line")"; then
      rm -f "$cmd_file"
      return 1
    fi
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
    rm -f "$cmd_file" >/dev/null 2>&1 || true
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

# Non-whitespace scrollback bytes for a spawned session. Prints -1 when the channel has
# no scrollback API (advisory only). screen -X hardcopy pads a blank buffer on some
# builds, so raw file size lies: count non-whitespace bytes instead.
pty_scrollback_bytes() {
  local channel="$1"
  local name="$2"
  if [[ -z "$name" ]]; then
    printf '%s' "-1"
    return 0
  fi
  local count=""
  case "$channel" in
    screen)
      local tmpfile
      tmpfile="$(mktemp "${TMPDIR:-/tmp}/agent-kit-audit-hardcopy.XXXXXX" 2>/dev/null || true)"
      if [[ -z "$tmpfile" ]]; then
        printf '%s' "-1"
        return 0
      fi
      # -p 0 is required: without an explicit window target a detached session writes an
      # empty hardcopy even when the PTY has output (observed on macOS screen 4.00).
      screen -S "$name" -p 0 -X hardcopy "$tmpfile" >/dev/null 2>&1 || true
      count="$(tr -d '[:space:]' < "$tmpfile" 2>/dev/null | wc -c | tr -d '[:space:]' || true)"
      rm -f "$tmpfile" >/dev/null 2>&1 || true
      ;;
    tmux)
      count="$(tmux capture-pane -p -t "$name" 2>/dev/null | tr -d '[:space:]' | wc -c | tr -d '[:space:]' || true)"
      ;;
    *)
      printf '%s' "-1"
      return 0
      ;;
  esac
  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
  printf '%s' "$count"
}

# 0 when the named session still exists. Channels without a session handle answer 0
# (unknown lifecycle is not evidence of death).
pty_session_alive() {
  local channel="$1"
  local name="$2"
  if [[ -z "$name" ]]; then
    return 1
  fi
  case "$channel" in
    screen)
      # screen -ls exits 1 while listing sessions, so capture first (pipefail is on).
      local listing
      listing="$(screen -ls 2>/dev/null || true)"
      if printf '%s\n' "$listing" | grep -q "\.${name}[[:space:]]"; then
        return 0
      fi
      return 1
      ;;
    tmux)
      if tmux has-session -t "$name" >/dev/null 2>&1; then
        return 0
      fi
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

# Dispose only the session this invocation spawned. No-op when the name is empty or the
# session is already gone. Never touches any other session (including other workspaces).
dispose_launched_session() {
  local channel="$1"
  local name="$2"
  if [[ -z "$name" ]]; then
    echo "audits: no session handle to dispose (channel: ${channel:-unknown})"
    return 0
  fi
  if ! is_owned_audit_session "$name"; then
    echo "audits: refuse dispose of non-owned session $name (workspace token ${AUDIT_WS_TOKEN})"
    return 0
  fi
  case "$channel" in
    screen)
      if pty_session_alive screen "$name"; then
        screen -S "$name" -X quit >/dev/null 2>&1 || true
      fi
      echo "audits: disposed screen session $name"
      ;;
    tmux)
      if pty_session_alive tmux "$name"; then
        tmux kill-session -t "$name" >/dev/null 2>&1 || true
      fi
      echo "audits: disposed tmux session $name"
      ;;
    *)
      echo "audits: no disposal path for channel ${channel:-unknown}"
      ;;
  esac
  return 0
}

# One line per existing workspace-owned session: channel<TAB>name<TAB>state<TAB>age_seconds.
# state is attached|detached; age_seconds is -1 when it cannot be determined (callers must
# treat unknown age as too young to reap). Prints nothing and succeeds when there is none.
# ADR: decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md
list_audit_sessions() {
  local now
  now="$(date +%s)"

  if command -v screen >/dev/null 2>&1; then
    # screen -ls exits 1 while listing sessions, so capture first (pipefail is on).
    local listing sockdir="" line pid name marker state socket mtime age
    listing="$(screen -ls 2>/dev/null || true)"
    while IFS= read -r line; do
      if [[ "$line" =~ ^[0-9]+[[:space:]]+Sockets?[[:space:]]+in[[:space:]]+(.+)\.$ ]]; then
        sockdir="${BASH_REMATCH[1]}"
      fi
    done <<< "$listing"
    while IFS= read -r line; do
      if ! [[ "$line" =~ ^[[:space:]]+([0-9]+)\.([^[:space:]]+)[[:space:]]+\((.*)\) ]]; then
        continue
      fi
      pid="${BASH_REMATCH[1]}"
      name="${BASH_REMATCH[2]}"
      marker="${BASH_REMATCH[3]}"
      # Workspace ownership + strict pattern (rejects prefix pollution / foreign tokens).
      if ! is_owned_audit_session "$name"; then
        continue
      fi
      if [[ "$marker" =~ [Aa]ttached ]]; then
        state="attached"
      else
        state="detached"
      fi
      age="-1"
      socket="$sockdir/$pid.$name"
      if [[ -n "$sockdir" && -e "$socket" ]]; then
        mtime="$(file_mtime_epoch "$socket")"
        if [[ "$mtime" =~ ^[0-9]+$ && "$mtime" -gt 0 && "$now" -ge "$mtime" ]]; then
          age=$((now - mtime))
        fi
      fi
      printf 'screen\t%s\t%s\t%s\n' "$name" "$state" "$age"
    done <<< "$listing"
  fi

  if command -v tmux >/dev/null 2>&1; then
    # No server running / no sessions: skip silently.
    local tmux_out t_name t_attached t_created t_state t_age
    tmux_out="$(tmux list-sessions -F '#{session_name} #{session_attached} #{session_created}' 2>/dev/null || true)"
    while read -r t_name t_attached t_created; do
      [[ -z "$t_name" ]] && continue
      if ! is_owned_audit_session "$t_name"; then
        continue
      fi
      if [[ "$t_attached" =~ ^[0-9]+$ && "$t_attached" -gt 0 ]]; then
        t_state="attached"
      else
        t_state="detached"
      fi
      t_age="-1"
      if [[ "$t_created" =~ ^[0-9]+$ && "$now" -ge "$t_created" ]]; then
        t_age=$((now - t_created))
      fi
      printf 'tmux\t%s\t%s\t%s\n' "$t_name" "$t_state" "$t_age"
    done <<< "$tmux_out"
  fi

  return 0
}

# Detached kit-owned sessions only: attached sessions are operator work in progress, not pile
# pressure, and are never disposed.
count_audit_sessions() {
  local count
  count="$(list_audit_sessions | awk -F'\t' '$3 == "detached"' | wc -l | tr -d '[:space:]' || true)"
  if ! [[ "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
  printf '%s' "$count"
}

# Operator disposal instructions. Namespace-scoped by design: never a bare quit on an
# unrelated session, never pkill, never a wildcard kill.
print_dispose_instructions() {
  cat <<EOF
dispose (opt-in; detached workspace-owned ${AUDIT_SESSION_OWNED_PREFIX}* sessions at or above ${AUDIT_REAP_MIN_AGE}s only):
  $LAUNCHER_REL --reap-audit-sessions --dry-run        # preview, kills nothing
  $LAUNCHER_REL --reap-audit-sessions                  # pure disposal, no audit starts
  $LAUNCHER_REL --reap-audit-sessions --force --autonomous <plan>  # reap then launch a new audit
  AGENT_KIT_AUDIT_REAP_MIN_AGE=0 lowers the age floor for one run.
Inspect first, then dispose one session at a time:
  screen -ls                          # or: tmux ls
  screen -S <session-name> -X quit    # or: tmux kill-session -t <session-name>
This workspace token: ${AUDIT_WS_TOKEN} (sessions: ${AUDIT_SESSION_OWNED_PREFIX}<pid>)
Legacy unscoped agent-kit-audit-<pid> names are not owned here; quit them manually if needed.
Policy: .cursor/memory/decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md
EOF
}

# Opt-in disposal of stale workspace-owned sessions. Called only when REAP_SESSIONS is 1.
# Skips attached sessions, unknown ages, foreign/legacy names, and anything younger than
# the age floor, printing one line per decision. Under --dry-run it lists candidates and
# kills nothing.
reap_audit_sessions() {
  local channel name state age seen=0
  while IFS=$'\t' read -r channel name state age; do
    [[ -z "$name" ]] && continue
    # Belt and braces: list_audit_sessions already filters to owned strict names.
    if ! is_owned_audit_session "$name"; then
      echo "audits: reap skip $name (not owned by workspace ${AUDIT_WS_TOKEN})"
      continue
    fi
    seen=$((seen + 1))
    if [[ "$state" == "attached" ]]; then
      echo "audits: reap skip $name (attached; operator-owned)"
      continue
    fi
    if [[ "$age" == "-1" ]]; then
      echo "audits: reap skip $name (age unknown; treated as too young)"
      continue
    fi
    if [[ "$age" -lt "$AUDIT_REAP_MIN_AGE" ]]; then
      echo "audits: reap skip $name (age ${age}s below min-age ${AUDIT_REAP_MIN_AGE}s)"
      continue
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "audits: reap candidate $name (channel: $channel, age ${age}s; dry-run, not disposed)"
      continue
    fi
    dispose_launched_session "$channel" "$name"
  done < <(list_audit_sessions)
  if [[ "$seen" -eq 0 ]]; then
    echo "audits: reap found no ${AUDIT_SESSION_OWNED_PREFIX}* sessions"
  fi
  return 0
}

# Pre-spawn pressure gate: reap when opted in, then warn or refuse on detached pile size.
# A refusal never spawns and never enters the monitor wait.
audit_session_pressure_gate() {
  local kind="${1:-review}"
  if [[ "$REAP_SESSIONS" -eq 1 ]]; then
    echo "audits: reaping detached ${AUDIT_SESSION_OWNED_PREFIX}* sessions (min-age: ${AUDIT_REAP_MIN_AGE}s)"
    reap_audit_sessions
  fi
  local count
  count="$(count_audit_sessions)"
  if [[ "$AUDIT_SESSION_CAP" -ne 0 && "$count" -ge "$AUDIT_SESSION_CAP" ]]; then
    cat <<EOF

audits: REFUSING to spawn - detached audit sessions are at the cap.
  detached ${AUDIT_SESSION_OWNED_PREFIX}* sessions: ${count}
  workspace token: ${AUDIT_WS_TOKEN}
  cap: ${AUDIT_SESSION_CAP} (AGENT_KIT_AUDIT_SESSION_CAP; 0 disables)
No audit is starting, no monitor will be written by this attempt, and the Field Report
stays owed. Dispose the pile, then re-arm.
EOF
    print_dispose_instructions
    emit_paste_only "$kind"
    soft_fail_exit
  fi
  if [[ "$AUDIT_SESSION_WARN" -ne 0 && "$count" -ge "$AUDIT_SESSION_WARN" ]]; then
    echo "audits: ${count} detached ${AUDIT_SESSION_OWNED_PREFIX}* sessions (warn threshold: ${AUDIT_SESSION_WARN}, cap: ${AUDIT_SESSION_CAP})"
    echo "  dispose: $LAUNCHER_REL --reap-audit-sessions --dry-run   (then drop --dry-run)"
  fi
  return 0
}

# Dry-run view of the pressure gate. Reap preview included when opted in; kills nothing.
print_session_pressure_dry_run() {
  local count
  count="$(count_audit_sessions)"
  echo "  audit-sessions: ${count} detached owned (warn: ${AUDIT_SESSION_WARN}, cap: ${AUDIT_SESSION_CAP})"
  echo "  audit-workspace-token: ${AUDIT_WS_TOKEN}"
  echo "  audit-session-prefix: ${AUDIT_SESSION_OWNED_PREFIX}"
  if [[ "$REAP_SESSIONS" -eq 1 ]]; then
    echo "  reap: yes (min-age: ${AUDIT_REAP_MIN_AGE}s; owned prefix only)"
    reap_audit_sessions | sed 's/^/  /'
  else
    echo "  reap: no (min-age: ${AUDIT_REAP_MIN_AGE}s; owned prefix only)"
  fi
  if [[ "$AUDIT_SESSION_CAP" -ne 0 && "$count" -ge "$AUDIT_SESSION_CAP" ]]; then
    echo "  audit-sessions-gate: would refuse to spawn (cap reached)"
  elif [[ "$AUDIT_SESSION_WARN" -ne 0 && "$count" -ge "$AUDIT_SESSION_WARN" ]]; then
    echo "  audit-sessions-gate: would warn and continue"
  else
    echo "  audit-sessions-gate: clear"
  fi
}

# Poll a spawned PTY for output beyond the launcher banner. 0 = activity observed, gate
# skipped, or gate disabled. 1 = silent PTY (session vanished, or grace window closed with
# only the pre-exec banner). ADR: decisions/2026-07-30_audits-pty-progress-gate-zombie-policy.md
wait_for_pty_progress() {
  local channel="$1"
  local name="$2"
  if [[ "$PROGRESS_TIMEOUT" -eq 0 ]]; then
    echo "audits: progress gate disabled (AGENT_KIT_AUDIT_PROGRESS_TIMEOUT=0)"
    return 0
  fi
  local bytes
  bytes="$(pty_scrollback_bytes "$channel" "$name")"
  if [[ "$bytes" == "-1" ]]; then
    echo "audits: progress gate skipped (channel: ${channel:-unknown}; no scrollback API)"
    return 0
  fi
  echo "audits: progress gate waiting for PTY output (timeout=${PROGRESS_TIMEOUT}s session=${name})"
  local start now elapsed
  start="$(date +%s)"
  # The launcher prints a pre-exec banner before exec claude. Wait briefly for it to land,
  # then measure it as the baseline. The gate must see growth *beyond* that banner, not
  # just any non-zero scrollback, so a stalled Claude after a healthy launch is still caught.
  sleep 2
  local baseline
  baseline="$(pty_scrollback_bytes "$channel" "$name")"
  local banner_wait=0
  while [[ "$baseline" == "0" ]] && [[ "$banner_wait" -lt 5 ]]; do
    sleep 1
    baseline="$(pty_scrollback_bytes "$channel" "$name")"
    banner_wait=$((banner_wait + 1))
  done
  if [[ "$baseline" == "0" ]]; then
    echo "audits: progress gate failed (launcher banner did not appear)"
    return 1
  fi
  local growth_threshold=50
  while true; do
    bytes="$(pty_scrollback_bytes "$channel" "$name")"
    now="$(date +%s)"
    elapsed=$((now - start))
    if [[ "$bytes" != "-1" && "$bytes" -gt $((baseline + growth_threshold)) ]]; then
      echo "audits: progress gate passed (scrollback grew from ${baseline} to ${bytes} bytes after ${elapsed}s)"
      return 0
    fi
    if ! pty_session_alive "$channel" "$name"; then
      echo "audits: progress gate failed (session ${name} vanished before producing output)"
      return 1
    fi
    if [[ "$elapsed" -ge "$PROGRESS_TIMEOUT" ]]; then
      echo "audits: progress gate failed (no growth beyond launcher banner after ${elapsed}s; baseline=${baseline}, current=${bytes})"
      return 1
    fi
    if [[ "$elapsed" -gt 0 && $((elapsed % 20)) -eq 0 ]]; then
      echo "audits: progress gate still silent beyond banner (${elapsed}s elapsed, baseline=${baseline}, current=${bytes})"
    fi
    sleep 2
  done
}

# Silent PTY after a successful spawn: honest failed launch, not a running review.
# Diagnose, dispose this run's session, print the paste fallback, then soft-fail.
# Never enters wait_for_monitors, so the --wait-timeout budget is not burned.
abort_silent_pty() {
  local kind="${1:-review}"
  cat <<EOF

audits: silent PTY - treating this as a FAILED LAUNCH, not a running review.
  channel: ${LAUNCH_CHANNEL:-unknown}
  session: ${LAUNCH_SESSION_NAME:-unknown}
The spawn succeeded, but the PTY produced no output within ${PROGRESS_TIMEOUT}s.
No audit is running, no monitor will be written by this attempt, and the Field Report
stays owed. Skipping the monitor wait instead of burning the remaining --wait-timeout.
EOF
  dispose_launched_session "$LAUNCH_CHANNEL" "$LAUNCH_SESSION_NAME"
  emit_paste_only "$kind"
  soft_fail_exit
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
- Delivery truth first: was each completed to-do actually done? Cite path/SHA/command/artifact; docs and HANDOFF are indicative only
- Finding priority: (1) delivery truth (2) security (3) logic gaps (4) bad code/practices; no filler "looks good" without evidence
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
- Delivery truth first: was each completed to-do actually done? Cite path/SHA/command/artifact; docs and HANDOFF are indicative only
- Finding priority: (1) delivery truth (2) security (3) logic gaps (4) bad code/practices; no filler "looks good" without evidence
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

# File mtime as unix epoch (macOS stat -f %m; Linux stat -c %Y). Accepts any existing path:
# screen session sockets are FIFOs, not regular files, and are aged by the same mtime read.
file_mtime_epoch() {
  local full="$1"
  if [[ ! -e "$full" ]]; then
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
  if [[ "$PROGRESS_TIMEOUT" -eq 0 ]]; then
    echo "  progress-gate: disabled"
  else
    echo "  progress-gate: yes"
  fi
  echo "  progress-timeout: ${PROGRESS_TIMEOUT}s"
  echo "  progress-gate-channel: resolved at spawn time (tmux/screen sampled; other channels advisory)"
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

# Pure disposal mode: --reap-audit-sessions with no plan argument reaps and exits.
# This avoids coupling cleanup to a new audit spawn. --dry-run previews only.
if [[ "$REAP_SESSIONS" -eq 1 && "$BATCH" -eq 0 && "${#PLAN_ARGS[@]}" -eq 0 ]]; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "audits: reap-only dry-run preview (no plan argument; no audit will start)"
  else
    echo "audits: reap-only mode (no plan argument; no audit will start)"
  fi
  reap_audit_sessions
  exit 0
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
    print_session_pressure_dry_run
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
      audit_session_pressure_gate "batch review"
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
        if ! wait_for_pty_progress "$LAUNCH_CHANNEL" "$LAUNCH_SESSION_NAME"; then
          abort_silent_pty "batch review"
        fi
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
  print_session_pressure_dry_run
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
    audit_session_pressure_gate "review"
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
      if ! wait_for_pty_progress "$LAUNCH_CHANNEL" "$LAUNCH_SESSION_NAME"; then
        abort_silent_pty "review"
      fi
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
