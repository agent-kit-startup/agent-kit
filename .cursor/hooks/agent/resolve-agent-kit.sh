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

# Exec the resolved CLI with quoted arguments, so a repo path with spaces works.
# Returns 1 (no exec) when a node script resolved but node is missing: exec of a
# missing binary would exit a non-interactive shell before any fail-open fallback.
run_agent_kit() {
  if [ -n "${AGENT_KIT_RESOLVED_SCRIPT:-}" ]; then
    command -v node >/dev/null 2>&1 || return 1
    exec node "$AGENT_KIT_RESOLVED_SCRIPT" "$@"
  fi
  # A shim that finds node through PATH (`#!/usr/bin/env node`, or a pnpm/cmd-shim
  # `#!/bin/sh` wrapper that runs `exec node ...`) would exec fine and then exit 127
  # with no output, so require node on PATH for those. An absolute interpreter
  # (`#!/opt/homebrew/bin/node`) does not need PATH and execs as before.
  _ak_bin=$AGENT_KIT_RESOLVED
  [ -f "$_ak_bin" ] || _ak_bin=$(command -v "$_ak_bin" 2>/dev/null) || _ak_bin=""
  if [ -n "$_ak_bin" ] && head -n 20 "$_ak_bin" 2>/dev/null |
    grep -Eq '^#![[:space:]]*[^[:space:]]*/env([[:space:]]+-S)?[[:space:]]+node([[:space:]]|$)|exec[[:space:]]+node[[:space:]]'; then
    # A pnpm/cmd-shim wrapper runs its sibling "$basedir/node" first when present.
    command -v node >/dev/null 2>&1 || [ -x "$(dirname "$_ak_bin")/node" ] || return 1
  fi
  exec "$AGENT_KIT_RESOLVED" "$@"
}
