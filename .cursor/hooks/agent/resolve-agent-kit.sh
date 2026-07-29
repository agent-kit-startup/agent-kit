#!/usr/bin/env sh
# Resolve agent-kit CLI for thin Cursor hook adapters (fail-open when missing).
# Sets AGENT_KIT_RESOLVED to a command prefix suitable for eval/exec.
# Usage: . resolve-agent-kit.sh && $AGENT_KIT_RESOLVED hook session-start

resolve_agent_kit() {
  if [ -n "${AGENT_KIT_HOOK_BIN:-}" ] && [ -x "$AGENT_KIT_HOOK_BIN" ]; then
    AGENT_KIT_RESOLVED="$AGENT_KIT_HOOK_BIN"
    return 0
  fi
  if command -v agent-kit >/dev/null 2>&1; then
    AGENT_KIT_RESOLVED="agent-kit"
    return 0
  fi

  # Walk up from this script: .cursor/hooks/agent -> repo root
  _script_dir=$(CDPATH= cd -- "$(dirname "$0")" 2>/dev/null && pwd)
  _root=$(CDPATH= cd -- "$_script_dir/../../.." 2>/dev/null && pwd)

  if [ -n "$_root" ] && [ -x "$_root/node_modules/.bin/agent-kit" ]; then
    AGENT_KIT_RESOLVED="$_root/node_modules/.bin/agent-kit"
    return 0
  fi
  if [ -n "$_root" ] && [ -f "$_root/packages/cli/dist/index.js" ]; then
    AGENT_KIT_RESOLVED="node $_root/packages/cli/dist/index.js"
    return 0
  fi

  return 1
}
