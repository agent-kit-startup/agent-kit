#!/usr/bin/env sh
# Resolve agent-kit CLI for thin Cursor hook adapters (fail-open when missing).
# Sets AGENT_KIT_RESOLVED to a command prefix (kept for older adapters) and
# AGENT_KIT_RESOLVED_SCRIPT when the CLI is a node script.
# Usage: . resolve-agent-kit.sh && resolve_agent_kit && run_agent_kit hook session-start
# The Claude SessionStart command sets _AGENT_KIT_HOOK_ROOT (hook-private, not read from
# a user's exported AGENT_KIT_ROOT) because under `sh -c` $0 is not this script.

resolve_agent_kit() {
  AGENT_KIT_RESOLVED_SCRIPT=""
  if [ -n "${AGENT_KIT_HOOK_BIN:-}" ] && [ -x "$AGENT_KIT_HOOK_BIN" ]; then
    AGENT_KIT_RESOLVED="$AGENT_KIT_HOOK_BIN"
    return 0
  fi
  # _AGENT_KIT_HOOK_ROOT first: when sourced from `sh -c`, $0 is the shell, not this script.
  _root="${_AGENT_KIT_HOOK_ROOT:-}"
  if [ -z "$_root" ]; then
    # Walk up from this script: .cursor/hooks/agent -> repo root
    _script_dir=$(CDPATH= cd -- "$(dirname "$0")" 2>/dev/null && pwd)
    _root=$(CDPATH= cd -- "$_script_dir/../../.." 2>/dev/null && pwd)
  fi

  if [ -n "$_root" ] && [ -x "$_root/node_modules/.bin/agent-kit" ]; then
    AGENT_KIT_RESOLVED="$_root/node_modules/.bin/agent-kit"
    return 0
  fi
  if [ -n "$_root" ] && [ -f "$_root/packages/cli/dist/index.js" ]; then
    AGENT_KIT_RESOLVED="node $_root/packages/cli/dist/index.js"
    AGENT_KIT_RESOLVED_SCRIPT="$_root/packages/cli/dist/index.js"
    return 0
  fi
  # Global CLI last, so the project's pinned version wins (same order as doctor).
  if command -v agent-kit >/dev/null 2>&1; then
    AGENT_KIT_RESOLVED="agent-kit"
    return 0
  fi

  return 1
}

# Run the resolved CLI with quoted arguments, so a repo path with spaces works.
# On success it prints the CLI's stdout byte for byte and exits with the CLI's
# status, like the exec it replaces: nothing after the call runs. It returns 1
# instead, and sets AGENT_KIT_RUN_FAILURE (a JSON-string-safe reason), when the
# CLI cannot answer the hook:
# - node is missing for a node script or a node shim (no run at all);
# - the CLI ran but exited non-zero with nothing on stdout (AGENT_KIT_RUN_EXIT
#   holds the status): a mise or asdf shim with no agent-kit for the Node active
#   in this workspace prints only to stderr and exits 1.
# The caller then prints its own fail-open answer. No extra probe spawn per call.
run_agent_kit() {
  AGENT_KIT_RUN_FAILURE=""
  AGENT_KIT_RUN_EXIT=""
  if [ -n "${AGENT_KIT_RESOLVED_SCRIPT:-}" ]; then
    if ! command -v node >/dev/null 2>&1; then
      AGENT_KIT_RUN_FAILURE="node not found for the resolved CLI"
      return 1
    fi
    _ak_bin=$AGENT_KIT_RESOLVED_SCRIPT
    set -- node "$AGENT_KIT_RESOLVED_SCRIPT" "$@"
  else
    # A shim that finds node through PATH (`#!/usr/bin/env node`, or a pnpm/cmd-shim
    # `#!/bin/sh` wrapper that runs `exec node ...`) would run and then exit 127
    # with no output, so require node on PATH for those. An absolute interpreter
    # (`#!/opt/homebrew/bin/node`) does not need PATH and runs as before.
    _ak_bin=$AGENT_KIT_RESOLVED
    [ -f "$_ak_bin" ] || _ak_bin=$(command -v "$_ak_bin" 2>/dev/null) || _ak_bin=""
    if [ -n "$_ak_bin" ] && head -n 20 "$_ak_bin" 2>/dev/null |
      grep -Eq '^#![[:space:]]*[^[:space:]]*/env([[:space:]]+-S)?[[:space:]]+node([[:space:]]|$)|exec[[:space:]]+node[[:space:]]'; then
      # A pnpm/cmd-shim wrapper runs its sibling "$basedir/node" first when present.
      if ! command -v node >/dev/null 2>&1 && ! [ -x "$(dirname "$_ak_bin")/node" ]; then
        AGENT_KIT_RUN_FAILURE="node not found for the resolved CLI"
        return 1
      fi
    fi
    set -- "$AGENT_KIT_RESOLVED" "$@"
  fi
  # The trailing x keeps trailing newlines that $(...) would strip (a Claude
  # PreToolUse allow is zero bytes, a Cursor answer ends in a newline). The ||
  # and if forms read the status without tripping a caller's set -e.
  if _ak_out=$(
    _ak_rc=0
    "$@" || _ak_rc=$?
    printf x
    exit "$_ak_rc"
  ); then _ak_rc=0; else _ak_rc=$?; fi
  _ak_out=${_ak_out%x}
  if [ "$_ak_rc" -ne 0 ] && [ -z "$_ak_out" ]; then
    AGENT_KIT_RUN_EXIT=$_ak_rc
    _ak_where=${_ak_bin:-$AGENT_KIT_RESOLVED}
    # Name the path only when it is safe inside a JSON string.
    case $_ak_where in
      *\"* | *\\* | *[[:cntrl:]]*) _ak_where="" ;;
    esac
    AGENT_KIT_RUN_FAILURE="the resolved CLI ${_ak_where:+$_ak_where }exited $_ak_rc with no output"
    return 1
  fi
  printf '%s' "$_ak_out"
  exit "$_ak_rc"
}
