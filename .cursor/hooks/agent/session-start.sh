#!/usr/bin/env sh
# Thin adapter: sessionStart -> agent-kit hook session-start (fail-open).
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/resolve-agent-kit.sh"
if ! resolve_agent_kit; then
  # Fail-open: empty additional context
  printf '%s\n' '{}'
  exit 0
fi
# shellcheck disable=SC2086
exec $AGENT_KIT_RESOLVED hook session-start
