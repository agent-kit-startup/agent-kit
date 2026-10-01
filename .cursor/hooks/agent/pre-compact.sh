#!/usr/bin/env sh
# Thin adapter: preCompact -> agent-kit hook pre-compact (fail-open).
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/resolve-agent-kit.sh"
if ! resolve_agent_kit; then
  printf '%s\n' '{}'
  exit 0
fi
# An older preserved resolver has no run_agent_kit; exec its command prefix.
if command -v run_agent_kit >/dev/null 2>&1; then
  # run_agent_kit returns 1 (no exec) when the CLI is a node script and node is missing.
  run_agent_kit hook pre-compact || {
    printf '%s\n' '{}'
    exit 0
  }
fi
# shellcheck disable=SC2086
exec $AGENT_KIT_RESOLVED hook pre-compact
