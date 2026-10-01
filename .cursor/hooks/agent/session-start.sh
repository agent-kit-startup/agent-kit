#!/usr/bin/env sh
# Thin adapter: sessionStart -> agent-kit hook session-start (fail-open).
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/resolve-agent-kit.sh"
if ! resolve_agent_kit; then
  # Fail-open, but not silent: sessionStart is the only hook that can surface
  # text to the session, so it carries the degraded-mode diagnostic for all
  # five adapters (stateless, per-session; see docs/marketplace.md, "Hook
  # resolution boundary").
  printf '%s\n' '{"additional_context": "Agent Kit hooks are running in degraded fail-open mode: the agent-kit CLI could not be resolved (checked AGENT_KIT_HOOK_BIN, node_modules/.bin, packages/cli/dist, PATH). Rules/commands/skills still work; hook-provided context, shell guard, schema check, and secrets scan are inactive. Fix: install the CLI (npm i -D @dadado/agent-kit-cli) or set AGENT_KIT_HOOK_BIN."}'
  exit 0
fi
# An older preserved resolver has no run_agent_kit; exec its command prefix.
if command -v run_agent_kit >/dev/null 2>&1; then
  # run_agent_kit returns 1 (no exec) when the CLI is a node script and node is missing.
  run_agent_kit hook session-start || {
    printf '%s\n' '{"additional_context": "Agent Kit hooks are running in degraded fail-open mode: the agent-kit CLI resolved to a node script but node is not on PATH. Rules/commands/skills still work; hook-provided context, shell guard, schema check, and secrets scan are inactive. Fix: put node on PATH for the IDE, or set AGENT_KIT_HOOK_BIN."}'
    exit 0
  }
fi
# shellcheck disable=SC2086
exec $AGENT_KIT_RESOLVED hook session-start
