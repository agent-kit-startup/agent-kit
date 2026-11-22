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
  AGENT_KIT_RUN_FAILURE=""
  AGENT_KIT_RUN_EXIT=""
  # run_agent_kit exits with the CLI's status once the CLI answered. It returns 1
  # when node is missing for a node script, or when the CLI exited non-zero with
  # no stdout (AGENT_KIT_RUN_EXIT set; the reason names the resolved path).
  run_agent_kit hook session-start || {
    if [ -n "${AGENT_KIT_RUN_EXIT:-}" ]; then
      printf '{"additional_context": "Agent Kit hooks are running in degraded fail-open mode: %s. A version-manager shim (mise, asdf) does this when the Node version active in this workspace has no agent-kit installed. Rules/commands/skills still work; hook-provided context, shell guard, schema check, and secrets scan are inactive. Fix: run that CLI with --version from this workspace to see its error, then install the CLI for that Node (npm i -g @dadado/agent-kit-cli, then mise reshim under mise) or in the project (npm i -D @dadado/agent-kit-cli), or set AGENT_KIT_HOOK_BIN."}\n' "$AGENT_KIT_RUN_FAILURE"
    else
      printf '%s\n' '{"additional_context": "Agent Kit hooks are running in degraded fail-open mode: the agent-kit CLI resolved to a node script but node is not on PATH. Rules/commands/skills still work; hook-provided context, shell guard, schema check, and secrets scan are inactive. Fix: put node on PATH for the IDE, or set AGENT_KIT_HOOK_BIN."}'
    fi
    exit 0
  }
fi
# shellcheck disable=SC2086
exec $AGENT_KIT_RESOLVED hook session-start
