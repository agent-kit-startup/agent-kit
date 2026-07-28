#!/usr/bin/env bash
# run-plan-all-consolidate.sh - safe apply path for /run-plan-all consolidations.
#
# ADR: .cursor/memory/decisions/2026-07-26_run-plan-all-queue-contract.md
# ADR: .cursor/memory/decisions/2026-07-26_backlog-crud-commands-contract.md
# Hard constraints:
#   - Default is --dry-run (no mutations)
#   - --apply requires --approved (confirm Ask already granted)
#   - Never /git-prod; never broad git add
#   - /backlog-add|edit|delete|cancel MUST NOT call this script to rewrite
#     Run queue / Queue cursor / Queue outcomes (caller=backlog-crud refuses
#     when a /run-plan-all queue is in flight)
#   - Active HANDOFF - **Plan:** is only changed with --activate
#
# Canonical path: .cursor/scripts/run-plan-all-consolidate.sh
# Compatibility wrapper: scripts/run-plan-all-consolidate.sh
#
# Usage:
#   .cursor/scripts/run-plan-all-consolidate.sh --help
#   .cursor/scripts/run-plan-all-consolidate.sh --preflight
#   .cursor/scripts/run-plan-all-consolidate.sh --drop PLAN.md
#   .cursor/scripts/run-plan-all-consolidate.sh --drop PLAN.md --apply --approved
#   .cursor/scripts/run-plan-all-consolidate.sh --rewrite-queue --queue "a.plan.md,b.plan.md" \
#       [--cursor 0] [--status running] [--activate a.plan.md] [--outcomes "none"]
#   .cursor/scripts/run-plan-all-consolidate.sh --merge-checklist SOURCE.md TARGET.md
#
# Smoke (dry-run, no mutations):
#   .cursor/scripts/run-plan-all-consolidate.sh --preflight
#   .cursor/scripts/run-plan-all-consolidate.sh --drop some.plan.md
#   .cursor/scripts/run-plan-all-consolidate.sh --merge-checklist a.plan.md b.plan.md
#
# Modes:
#   Default / --dry-run: print planned mutations; exit 0 if preflight would pass.
#   --apply --approved: perform mutations after confirm Ask.
#   --caller backlog-crud: refuse queue rewrite and refuse any apply when queue in flight.
#   --caller run-plan-all (default): may rewrite queue after confirm Ask.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HANDOFF="$ROOT/.cursor/HANDOFF.md"
PLANS_DIR="$ROOT/.cursor/plans"
ARCHIVE_DIR="$PLANS_DIR/archive"
LAUNCHER_REL=".cursor/scripts/run-plan-all-consolidate.sh"

DRY_RUN=1
APPLY=0
APPROVED=0
FORCE_OVERWRITE=0
CALLER="run-plan-all"
ACTION=""
PLAN_ARG=""
SOURCE_ARG=""
TARGET_ARG=""
QUEUE_CSV=""
CURSOR="0"
STATUS="running"
ACTIVATE=""
OUTCOMES="none"
TOUCH_ACTIVE_PLAN=0

usage() {
  sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  echo "error: $*" >&2
  exit 1
}

warn() {
  echo "warn: $*" >&2
}

info() {
  echo "$*"
}

normalize_plan() {
  local name="$1"
  name="${name##*/}"
  if [[ "$name" != *.plan.md ]]; then
    name="${name%.md}"
    name="${name%.plan}"
    name="${name}.plan.md"
  fi
  printf '%s' "$name"
}

handoff_field() {
  local label="$1"
  [[ -f "$HANDOFF" ]] || { printf ''; return 0; }
  # Match "- **Label:** value" (first hit)
  sed -n "s/^- \\*\\*${label}:\\*\\*[[:space:]]*//p" "$HANDOFF" | head -n 1
}

queue_in_flight() {
  [[ -f "$HANDOFF" ]] || return 1
  local mode status queue
  mode="$(handoff_field "Mode")"
  status="$(handoff_field "Queue status")"
  queue="$(handoff_field "Run queue")"
  [[ "$mode" == "run-plan-all" ]] || return 1
  if [[ "$status" == "running" || "$status" == "paused" || "$status" == "blocked" ]]; then
    return 0
  fi
  # Non-empty Run queue with a cursor implies in-flight even if status wording drifts
  if [[ -n "$queue" && "$queue" != "none" && "$queue" != "[]" && "$queue" != "[ ]" ]]; then
    local cursor
    cursor="$(handoff_field "Queue cursor")"
    if [[ -n "$cursor" && "$cursor" != "none" ]]; then
      return 0
    fi
  fi
  return 1
}

require_plans_dir() {
  [[ -d "$PLANS_DIR" ]] || die "missing plans dir: $PLANS_DIR"
}

plan_live_path() {
  printf '%s/%s' "$PLANS_DIR" "$1"
}

plan_archive_path() {
  printf '%s/%s' "$ARCHIVE_DIR" "$1"
}

assert_plan_live() {
  local basename="$1"
  local path
  path="$(plan_live_path "$basename")"
  [[ -f "$path" ]] || die "plan not found under .cursor/plans/: $basename"
  if [[ -f "$(plan_archive_path "$basename")" ]]; then
    warn "also present under archive/ (live copy takes precedence for mutations): $basename"
  fi
}

active_plan_basename() {
  local raw
  raw="$(handoff_field "Plan")"
  raw="${raw//\`/}"
  raw="${raw##*/}"
  printf '%s' "$raw"
}

preflight_common() {
  require_plans_dir
  if [[ ! -f "$HANDOFF" ]]; then
    warn "HANDOFF missing at $HANDOFF (queue rewrite will create minimal bullets only if --apply)"
  fi

  if [[ "$CALLER" == "backlog-crud" ]]; then
    if queue_in_flight; then
      die "caller=backlog-crud refused: /run-plan-all queue is in flight (Mode run-plan-all + running/paused/blocked or non-empty Run queue). Backlog CRUD must not mutate Run queue / Queue cursor / Queue outcomes (ADR 2026-07-26_backlog-crud-commands-contract)."
    fi
    if [[ "$ACTION" == "rewrite-queue" ]]; then
      die "caller=backlog-crud must never rewrite Run queue (use /run-plan-all after confirm Ask)"
    fi
  fi

  if [[ "$APPLY" -eq 1 && "$APPROVED" -eq 0 ]]; then
    die "--apply requires --approved (confirm Ask already granted). Default remains --dry-run."
  fi

  if [[ "$APPLY" -eq 1 && "$CALLER" == "backlog-crud" ]] && queue_in_flight; then
    die "caller=backlog-crud refused apply while queue in flight"
  fi
}

extract_todo_ids() {
  local file="$1"
  # Best-effort: ids under frontmatter todos: blocks (id: foo)
  awk '
    BEGIN { in_fm=0; in_todos=0 }
    /^---[[:space:]]*$/ {
      if (in_fm==0) { in_fm=1; next }
      if (in_fm==1) { exit }
    }
    in_fm==1 && /^todos:[[:space:]]*$/ { in_todos=1; next }
    in_fm==1 && in_todos==1 && /^[a-zA-Z]/ { in_todos=0 }
    in_fm==1 && in_todos==1 && /^[[:space:]]*-?[[:space:]]*id:[[:space:]]*/ {
      line=$0
      sub(/^[[:space:]]*-?[[:space:]]*id:[[:space:]]*/, "", line)
      gsub(/["'\'']/, "", line)
      print line
    }
  ' "$file"
}

extract_pending_todo_ids() {
  local file="$1"
  # Pair id + nearest status within the same list item (heuristic)
  awk '
    BEGIN { in_fm=0; in_todos=0; cur=""; st="" }
    /^---[[:space:]]*$/ {
      if (in_fm==0) { in_fm=1; next }
      if (in_fm==1) {
        if (cur != "" && (st == "pending" || st == "in_progress" || st == "")) print cur
        exit
      }
    }
    in_fm==1 && /^todos:[[:space:]]*$/ { in_todos=1; next }
    in_fm==1 && in_todos==1 && /^[a-zA-Z]/ {
      if (cur != "" && (st == "pending" || st == "in_progress" || st == "")) print cur
      in_todos=0
    }
    in_fm==1 && in_todos==1 && /^[[:space:]]*-[[:space:]]/ {
      if (cur != "" && (st == "pending" || st == "in_progress" || st == "")) print cur
      cur=""; st=""
    }
    in_fm==1 && in_todos==1 && /id:[[:space:]]*/ {
      line=$0
      sub(/^.*id:[[:space:]]*/, "", line)
      gsub(/["'\'']/, "", line)
      cur=line
    }
    in_fm==1 && in_todos==1 && /status:[[:space:]]*/ {
      line=$0
      sub(/^.*status:[[:space:]]*/, "", line)
      gsub(/["'\'']/, "", line)
      st=line
    }
  ' "$file"
}

cmd_preflight() {
  preflight_common
  info "preflight ok"
  info "  root: $ROOT"
  info "  handoff: ${HANDOFF} ($( [[ -f "$HANDOFF" ]] && echo present || echo missing ))"
  info "  caller: $CALLER"
  info "  dry-run: $( [[ "$DRY_RUN" -eq 1 ]] && echo yes || echo no )"
  if queue_in_flight; then
    info "  queue in flight: yes (Mode=$(handoff_field "Mode"); status=$(handoff_field "Queue status"))"
  else
    info "  queue in flight: no"
  fi
  local active
  active="$(active_plan_basename)"
  info "  active Plan: ${active:-none}"
}

cmd_drop() {
  local basename="$1"
  basename="$(normalize_plan "$basename")"
  preflight_common
  assert_plan_live "$basename"

  local active
  active="$(active_plan_basename)"
  if [[ -n "$active" && "$active" == "$basename" && "$TOUCH_ACTIVE_PLAN" -eq 0 ]]; then
    die "refusing to archive active HANDOFF Plan ($basename) without --activate (park/finish or activate another plan first)"
  fi

  local src dst
  src="$(plan_live_path "$basename")"
  dst="$(plan_archive_path "$basename")"

  if [[ -e "$dst" && "$FORCE_OVERWRITE" -eq 0 ]]; then
    die "archive target exists (refuse overwrite without --force-overwrite): $dst"
  fi

  info "drop/archive: $basename"
  info "  from: $src"
  info "  to:   $dst"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    info "dry-run: no files moved (pass --apply --approved to mutate)"
    return 0
  fi

  mkdir -p "$ARCHIVE_DIR"
  if [[ -e "$dst" && "$FORCE_OVERWRITE" -eq 1 ]]; then
    rm -f "$dst"
  fi
  mv "$src" "$dst"
  info "moved $basename -> .cursor/plans/archive/"
}

upsert_handoff_field() {
  # args: label value_file_or_inline
  # Rewrites or appends "- **Label:** value" in HANDOFF.
  local label="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if [[ ! -f "$HANDOFF" ]]; then
    {
      echo "# Handoff - run-plan-all queue"
      echo ""
      echo "- **Plan:** \`none\`"
      echo "- **Last updated:** $(date '+%Y-%m-%d %H:%M')"
      echo "- **Mode:** run-plan-all"
    } >"$HANDOFF"
  fi

  if grep -q "^- \\*\\*${label}:\\*\\*" "$HANDOFF"; then
    # Replace first matching line only
    awk -v lab="$label" -v val="$value" '
      BEGIN { done=0 }
      {
        if (!done && $0 ~ ("^- \\*\\*" lab ":\\*\\*")) {
          print "- **" lab ":** " val
          done=1
          next
        }
        print
      }
    ' "$HANDOFF" >"$tmp"
  else
    # Append before trailing blank or at EOF
    cat "$HANDOFF" >"$tmp"
    printf '\n- **%s:** %s\n' "$label" "$value" >>"$tmp"
  fi
  mv "$tmp" "$HANDOFF"
}

replace_outcomes_block() {
  local outcomes_text="$1"
  local tmp
  tmp="$(mktemp)"
  awk -v outcomes="$outcomes_text" '
    BEGIN { skip=0; done=0 }
    {
      if ($0 ~ /^- \*\*Queue outcomes:\*\*/) {
        print "- **Queue outcomes:**"
        n = split(outcomes, lines, "\n")
        for (i = 1; i <= n; i++) {
          if (lines[i] != "") print "  " lines[i]
        }
        skip=1
        done=1
        next
      }
      if (skip == 1) {
        if ($0 ~ /^- \*\*/ || $0 ~ /^#/ || $0 ~ /^$/) {
          skip=0
          # fall through to print this line
        } else if ($0 ~ /^  / || $0 ~ /^[[:space:]]*-/) {
          next
        } else {
          skip=0
        }
      }
      if (skip == 0) print
    }
    END {
      if (!done) {
        print "- **Queue outcomes:**"
        n = split(outcomes, lines, "\n")
        for (i = 1; i <= n; i++) {
          if (lines[i] != "") print "  " lines[i]
        }
      }
    }
  ' "$HANDOFF" >"$tmp"
  mv "$tmp" "$HANDOFF"
}

cmd_rewrite_queue() {
  preflight_common
  [[ -n "$QUEUE_CSV" ]] || die "--rewrite-queue requires --queue \"a.plan.md,b.plan.md\""

  if [[ "$CALLER" == "backlog-crud" ]]; then
    die "caller=backlog-crud must never rewrite Run queue"
  fi

  local -a items=()
  local IFS=','
  # shellcheck disable=SC2206
  local raw_items=($QUEUE_CSV)
  unset IFS
  local item
  for item in "${raw_items[@]}"; do
    item="$(echo "$item" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -n "$item" ]] || continue
    item="$(normalize_plan "$item")"
    assert_plan_live "$item"
    items+=("$item")
  done
  [[ ${#items[@]} -gt 0 ]] || die "empty queue after normalize"

  local activate="$ACTIVATE"
  if [[ -n "$activate" ]]; then
    activate="$(normalize_plan "$activate")"
    assert_plan_live "$activate"
  else
    activate="${items[0]}"
  fi

  if ! [[ "$CURSOR" =~ ^[0-9]+$ ]]; then
    die "--cursor must be an integer index"
  fi
  if [[ "$CURSOR" -ge ${#items[@]} ]]; then
    die "--cursor $CURSOR out of range for queue length ${#items[@]}"
  fi

  local queue_bracket="["
  local i
  for i in "${!items[@]}"; do
    if [[ "$i" -gt 0 ]]; then
      queue_bracket+=", "
    fi
    queue_bracket+="${items[$i]}"
  done
  queue_bracket+="]"

  local cursor_line="${CURSOR} (current: ${items[$CURSOR]})"

  local outcomes_display="$OUTCOMES"
  if [[ "$OUTCOMES" == "none" ]]; then
    outcomes_display="- none"
  fi

  info "rewrite HANDOFF queue fields:"
  info "  Plan (activate): $activate"
  info "  Mode: run-plan-all"
  info "  Run queue: $queue_bracket"
  info "  Queue cursor: $cursor_line"
  info "  Queue status: $STATUS"
  info "  Queue outcomes: $outcomes_display"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    info "dry-run: HANDOFF not written (pass --apply --approved to mutate)"
    return 0
  fi

  upsert_handoff_field "Plan" "\`${activate}\`"
  upsert_handoff_field "Last updated" "$(date '+%Y-%m-%d %H:%M')"
  upsert_handoff_field "Mode" "run-plan-all"
  upsert_handoff_field "Run queue" "$queue_bracket"
  upsert_handoff_field "Queue cursor" "$cursor_line"
  upsert_handoff_field "Queue status" "$STATUS"
  replace_outcomes_block "$outcomes_display"
  info "HANDOFF queue fields updated"
}

cmd_merge_checklist() {
  local source target
  source="$(normalize_plan "$1")"
  target="$(normalize_plan "$2")"
  preflight_common
  assert_plan_live "$source"
  assert_plan_live "$target"
  [[ "$source" != "$target" ]] || die "source and target must differ"

  local src_path tgt_path
  src_path="$(plan_live_path "$source")"
  tgt_path="$(plan_live_path "$target")"

  info "merge checklist (agent-applied frontmatter; script does not rewrite YAML):"
  info "  source: $source"
  info "  target: $target"
  info ""
  info "1. Confirm Ask already granted for this merge (required before --drop --apply)."
  info "2. Unique pending/in_progress to-do ids in SOURCE not present in TARGET:"

  local -a src_ids=()
  local -a tgt_ids=()
  local id
  while IFS= read -r id; do
    [[ -n "$id" ]] && src_ids+=("$id")
  done < <(extract_pending_todo_ids "$src_path")
  while IFS= read -r id; do
    [[ -n "$id" ]] && tgt_ids+=("$id")
  done < <(extract_todo_ids "$tgt_path")

  local found_any=0
  for id in "${src_ids[@]:-}"; do
    local hit=0
    local t
    for t in "${tgt_ids[@]:-}"; do
      if [[ "$t" == "$id" ]]; then
        hit=1
        break
      fi
    done
    if [[ "$hit" -eq 0 ]]; then
      info "   - $id"
      found_any=1
    fi
  done
  if [[ "$found_any" -eq 0 ]]; then
    info "   (none; source pending ids already covered or source has no pending ids)"
  fi

  info "3. Copy those unique to-do blocks into TARGET frontmatter (preserve id/status/content)."
  info "4. Optionally note the merge under TARGET body (project voice; no chat meta)."
  info "5. Archive SOURCE:"
  info "     $LAUNCHER_REL --drop $source --apply --approved"
  info "6. Rewrite Run queue without SOURCE (after confirm Ask):"
  info "     $LAUNCHER_REL --rewrite-queue --queue \"...remaining...\" --activate $target --apply --approved"
  info ""
  info "Safe-over-clever: this script never auto-merges YAML. Agent edits TARGET, then --drop SOURCE."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    info "dry-run: no mutations performed"
  fi
}

# --- argv ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      APPLY=0
      shift
      ;;
    --apply)
      APPLY=1
      DRY_RUN=0
      shift
      ;;
    --approved)
      APPROVED=1
      shift
      ;;
    --force-overwrite)
      FORCE_OVERWRITE=1
      shift
      ;;
    --caller)
      CALLER="${2:-}"
      [[ -n "$CALLER" ]] || die "--caller requires backlog-crud|run-plan-all"
      shift 2
      ;;
    --preflight)
      ACTION="preflight"
      shift
      ;;
    --drop)
      ACTION="drop"
      PLAN_ARG="${2:-}"
      [[ -n "$PLAN_ARG" ]] || die "--drop requires PLAN.md"
      shift 2
      ;;
    --rewrite-queue)
      ACTION="rewrite-queue"
      shift
      ;;
    --queue)
      QUEUE_CSV="${2:-}"
      shift 2
      ;;
    --cursor)
      CURSOR="${2:-}"
      shift 2
      ;;
    --status)
      STATUS="${2:-}"
      shift 2
      ;;
    --activate)
      ACTIVATE="${2:-}"
      TOUCH_ACTIVE_PLAN=1
      shift 2
      ;;
    --outcomes)
      OUTCOMES="${2:-}"
      shift 2
      ;;
    --merge-checklist)
      ACTION="merge-checklist"
      SOURCE_ARG="${2:-}"
      TARGET_ARG="${3:-}"
      [[ -n "$SOURCE_ARG" && -n "$TARGET_ARG" ]] || die "--merge-checklist requires SOURCE TARGET"
      shift 3
      ;;
    --)
      shift
      break
      ;;
    -*)
      die "unknown option: $1 (try --help)"
      ;;
    *)
      die "unexpected argument: $1 (try --help)"
      ;;
  esac
done

[[ -n "$ACTION" ]] || die "no action; try --help (or --preflight / --drop / --rewrite-queue / --merge-checklist)"

case "$ACTION" in
  preflight)
    cmd_preflight
    ;;
  drop)
    cmd_drop "$PLAN_ARG"
    ;;
  rewrite-queue)
    cmd_rewrite_queue
    ;;
  merge-checklist)
    cmd_merge_checklist "$SOURCE_ARG" "$TARGET_ARG"
    ;;
  *)
    die "unknown action: $ACTION"
    ;;
esac
