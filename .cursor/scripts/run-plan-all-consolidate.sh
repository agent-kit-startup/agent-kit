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
# Queue rewrite invariants:
#   - Validate / normalize --outcomes (including multiline) BEFORE any HANDOFF mutation.
#   - Apply Plan/Mode/queue/cursor/status/outcomes as one atomic rewrite (temp + replace).
#   - Never use awk -v for outcomes (newlines break -v and caused partial rewrites).
#   - History is kept: Plan, Mode, Last updated, Queue cursor and Queue status become
#     "<new> · antes: <old value incl. its trail>" when the value changes (unchanged
#     head = line left as is). Run queue is replaced bare.
#   - Old Queue outcomes rows that --outcomes does not carry forward move to
#     "- **Queue outcomes anteriores:**" (newest first), never deleted.
#   - Dry-run and apply print the same line diff (- removed / + added) of HANDOFF.
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
  # Print the leading comment block (line 2 up to the first non-comment line).
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
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

# Current value of a field without its "· antes:" history trail.
field_head() {
  local value="$1"
  printf '%s' "${value%% · antes: *}"
}

queue_in_flight() {
  [[ -f "$HANDOFF" ]] || return 1
  local mode status queue
  mode="$(field_head "$(handoff_field "Mode")")"
  status="$(field_head "$(handoff_field "Queue status")")"
  status="${status%% *}"
  queue="$(handoff_field "Run queue")"
  [[ "$mode" == "run-plan-all" || "$mode" == "run-plan-all "* ]] || return 1
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
  local tick='`'
  raw="$(field_head "$(handoff_field "Plan")")"
  if [[ "$raw" == *"$tick"*"$tick"* ]]; then
    # Plan name inside the first pair of backticks, e.g. `a.plan.md` (queue cursor 3).
    raw="${raw#*"$tick"}"
    raw="${raw%%"$tick"*}"
  else
    raw="${raw%% *}"
  fi
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

# Upsert "- **Label:** value" inside a working copy (never mutates HANDOFF directly).
# Values travel through ENVIRON, never awk -v (which rewrites backslash escapes).
# trail=1 keeps history: "<new> · antes: <old value incl. its own trail>" when the
# old head differs; an unchanged head leaves the line byte-identical.
upsert_field_in_file() {
  local file="$1"
  local label="$2"
  local value="$3"
  local trail="${4:-0}"
  local tmp
  tmp="$(mktemp)"
  if grep -q "^- \\*\\*${label}:\\*\\*" "$file"; then
    UPSERT_LABEL="$label" UPSERT_VALUE="$value" UPSERT_TRAIL="$trail" awk '
      BEGIN {
        lab = ENVIRON["UPSERT_LABEL"]
        val = ENVIRON["UPSERT_VALUE"]
        trail = ENVIRON["UPSERT_TRAIL"]
        sep = " · antes: "
        done = 0
      }
      {
        if (!done && index($0, "- **" lab ":**") == 1) {
          done = 1
          old = substr($0, length("- **" lab ":**") + 1)
          sub(/^[ \t]+/, "", old)
          head = old
          cut = index(old, sep)
          if (cut > 0) head = substr(old, 1, cut - 1)
          sub(/[ \t]+$/, "", head)
          if (trail == "1" && head == val) { print; next }
          if (trail == "1" && old != "" && old != "none" && old != "`none`") {
            print "- **" lab ":** " val sep old
          } else {
            print "- **" lab ":** " val
          }
          next
        }
        print
      }
    ' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    printf '\n- **%s:** %s\n' "$label" "$value" >>"$tmp"
  fi
  mv "$tmp" "$file"
}

# Replace the live Queue outcomes block using a side file (multiline; never awk -v).
# Old rows that the new block does not carry forward (exact match after trim; "none"
# placeholders ignored) move to "- **Queue outcomes anteriores:**", newest first,
# right after the live block. Existing prior rows are kept (deduplicated).
replace_outcomes_in_file() {
  local file="$1"
  local outcomes_file="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v ofile="$outcomes_file" '
    function trim(x) { sub(/^[ \t]+/, "", x); sub(/[ \t]+$/, "", x); return x }
    function placeholder(x) { return (x == "" || x == "none" || x == "- none" || x == "`none`") }
    function is_live(x) { return (x ~ /^- \*\*Queue outcomes:\*\*/) }
    function is_prior(x) { return (x ~ /^- \*\*Queue outcomes anteriores:\*\*/) }
    function inline_of(x) { sub(/^- \*\*[^*]+:\*\*/, "", x); return trim(x) }
    # Same block-end rule as the original rewrite: a field, heading or blank line ends it.
    function ends_block(x) {
      if (x ~ /^- \*\*/ || x ~ /^#/ || x ~ /^$/) return 1
      if (x ~ /^  / || x ~ /^[[:space:]]*-/) return 0
      return 1
    }
    BEGIN {
      n = 0
      while ((getline line < ofile) > 0) {
        if (trim(line) == "") continue
        n++
        lines[n] = line
        isnew[trim(line)] = 1
      }
      close(ofile)
      nold = 0; nprior = 0; mode = 0
    }
    # Pass 1: collect old live rows and existing prior rows.
    FNR == NR {
      if (is_live($0)) { mode = 1; r = inline_of($0); if (r != "") old[++nold] = r; next }
      if (is_prior($0)) { mode = 2; r = inline_of($0); if (r != "") prior[++nprior] = r; next }
      if (mode != 0 && ends_block($0)) mode = 0
      if (mode == 1) old[++nold] = trim($0)
      else if (mode == 2) prior[++nprior] = trim($0)
      next
    }
    FNR == 1 {
      # Build the prior block: displaced rows first (newest), then existing ones.
      np = 0
      for (i = 1; i <= nold; i++) {
        r = old[i]
        if (placeholder(r) || (r in isnew) || (r in seen)) continue
        seen[r] = 1; outp[++np] = r
      }
      for (i = 1; i <= nprior; i++) {
        r = prior[i]
        if (placeholder(r) || (r in seen)) continue
        seen[r] = 1; outp[++np] = r
      }
      skip = 0; done = 0
    }
    function emit_blocks(   i) {
      print "- **Queue outcomes:**"
      for (i = 1; i <= n; i++) print "  " lines[i]
      if (np > 0) {
        print "- **Queue outcomes anteriores:**"
        for (i = 1; i <= np; i++) print "  " outp[i]
      }
    }
    # Pass 2: emit, dropping the old live and prior blocks wherever they are.
    {
      if (is_live($0)) {
        if (!done) emit_blocks()
        done = 1; skip = 1; next
      }
      if (is_prior($0)) { skip = 1; next }
      if (skip == 1) {
        if (ends_block($0)) skip = 0
        else next
      }
      print
    }
    END { if (!done) emit_blocks() }
  ' "$file" "$file" >"$tmp"
  mv "$tmp" "$file"
}

# Validate and normalize Queue outcomes BEFORE any HANDOFF mutation.
# Prints normalized body lines (without the "- **Queue outcomes:**" header) to stdout.
# Empty / "none" become "- none". (Bash argv cannot carry embedded NUL; no NUL check.)
normalize_outcomes() {
  local raw="$1"
  # Strip CR so Windows pastes do not create phantom lines
  raw="${raw//$'\r'/}"
  if [[ -z "$raw" || "$raw" == "none" ]]; then
    printf '%s\n' "- none"
    return 0
  fi
  local line
  local any=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim trailing whitespace only; preserve leading bullet / indent intent
    line="$(printf '%s' "$line" | sed 's/[[:space:]]*$//')"
    [[ -z "$line" ]] && continue
    # Refuse machine-field lookalikes that would corrupt HANDOFF structure
    if [[ "$line" =~ ^-\ \*\*[^*]+:\*\* ]]; then
      die "--outcomes line looks like a HANDOFF machine field (refusing): $line"
    fi
    printf '%s\n' "$line"
    any=1
  done <<< "$raw"
  if [[ "$any" -eq 0 ]]; then
    printf '%s\n' "- none"
  fi
}

# Atomic replace of dest with src (same-filesystem mv). Cleans src on success.
atomic_replace_file() {
  local src="$1"
  local dest="$2"
  local staged
  staged="$(mktemp "${dest}.XXXXXX")"
  cat "$src" >"$staged"
  mv "$staged" "$dest"
  rm -f "$src"
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

  # Validate / normalize outcomes BEFORE any HANDOFF write (Q7/Q8/Q9).
  local outcomes_file
  outcomes_file="$(mktemp)"
  normalize_outcomes "$OUTCOMES" >"$outcomes_file" || {
    rm -f "$outcomes_file"
    die "outcomes validation failed"
  }
  local outcomes_display
  outcomes_display="$(cat "$outcomes_file")"

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
  local stamp
  stamp="$(date '+%Y-%m-%d %H:%M')"

  info "rewrite HANDOFF queue fields:"
  info "  Plan (activate): $activate"
  info "  Mode: run-plan-all"
  info "  Run queue: $queue_bracket"
  info "  Queue cursor: $cursor_line"
  info "  Queue status: $STATUS"
  info "  Queue outcomes:"
  while IFS= read -r item || [[ -n "$item" ]]; do
    [[ -n "$item" ]] && info "    $item"
  done <<< "$outcomes_display"

  # Build the full rewrite in a working copy (dry-run and apply share it), then
  # print the line diff and, on apply, atomically replace HANDOFF.
  local work
  work="$(mktemp)"
  if [[ -f "$HANDOFF" ]]; then
    cat "$HANDOFF" >"$work"
  else
    {
      echo "# Handoff - run-plan-all queue"
      echo ""
      echo "- **Plan:** \`none\`"
      echo "- **Last updated:** $stamp"
      echo "- **Mode:** run-plan-all"
    } >"$work"
  fi

  upsert_field_in_file "$work" "Plan" "\`${activate}\`" 1
  upsert_field_in_file "$work" "Last updated" "$stamp" 1
  upsert_field_in_file "$work" "Mode" "run-plan-all" 1
  upsert_field_in_file "$work" "Run queue" "$queue_bracket"
  upsert_field_in_file "$work" "Queue cursor" "$cursor_line" 1
  upsert_field_in_file "$work" "Queue status" "$STATUS" 1
  replace_outcomes_in_file "$work" "$outcomes_file"
  rm -f "$outcomes_file"

  print_rewrite_diff "$work"
  local prior_rows
  prior_rows="$(awk '
    /^- \*\*Queue outcomes anteriores:\*\*/ { on = 1; next }
    on && (/^- \*\*/ || /^#/ || /^$/) { on = 0 }
    on && /^  / { c++ }
    END { print c + 0 }
  ' "$work")"
  info "Queue outcomes anteriores: ${prior_rows} row(s) kept from earlier queues"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    rm -f "$work"
    info "dry-run: HANDOFF not written (pass --apply --approved to mutate)"
    return 0
  fi

  atomic_replace_file "$work" "$HANDOFF"
  info "HANDOFF queue fields updated (atomic)"
}

# Print every HANDOFF line the rewrite removes (-) or adds (+). Unchanged lines are
# omitted; a "· antes:" trail shows up as the old line removed and the trailed line added.
print_rewrite_diff() {
  local work="$1"
  local base="$HANDOFF"
  [[ -f "$base" ]] || base="/dev/null"
  local out rc=0
  out="$(diff -U0 "$base" "$work")" || rc=$?
  if [[ "$rc" -gt 1 ]]; then
    die "diff failed (exit $rc) while previewing the HANDOFF rewrite"
  fi
  info "HANDOFF line diff (- removed, + added):"
  if [[ "$rc" -eq 0 ]]; then
    info "  (no changes)"
    return 0
  fi
  # Skip the two file headers and the @@ hunk markers; keep content lines verbatim.
  printf '%s\n' "$out" | tail -n +3 | grep -v '^@@' | sed 's/^/  /'
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
