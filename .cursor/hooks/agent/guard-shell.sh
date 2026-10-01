#!/usr/bin/env sh
# Thin adapter: beforeShellExecution -> agent-kit guard shell (fail-open allow).
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/resolve-agent-kit.sh"
if ! resolve_agent_kit; then
  # Still fail-open (never brick the session), but say the guard is not running.
  printf '%s\n' '{"permission":"allow","agent_message":"agent-kit guard inactive: CLI unresolved"}'
  exit 0
fi
# An older preserved resolver has no run_agent_kit; exec its command prefix.
if command -v run_agent_kit >/dev/null 2>&1; then
  # run_agent_kit returns 1 (no exec) when the CLI is a node script and node is missing.
  run_agent_kit guard shell --json || {
    printf '%s\n' '{"permission":"allow","agent_message":"agent-kit guard inactive: node not found for the resolved CLI"}'
    exit 0
  }
fi
# shellcheck disable=SC2086
exec $AGENT_KIT_RESOLVED guard shell --json
