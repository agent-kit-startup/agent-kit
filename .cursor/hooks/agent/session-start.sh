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
  printf '%s\n' '{"additional_context": "Agent Kit hooks are running in degraded fail-open mode: the agent-kit CLI could not be resolved (checked AGENT_KIT_HOOK_BIN, PATH, node_modules/.bin, packages/cli/dist). Rules/commands/skills still work; hook-provided context, shell guard, schema check, and secrets scan are inactive. Fix: install the CLI (npm i -D @dadado/agent-kit-cli) or set AGENT_KIT_HOOK_BIN."}'
  exit 0
fi
# shellcheck disable=SC2086
exec $AGENT_KIT_RESOLVED hook session-start
