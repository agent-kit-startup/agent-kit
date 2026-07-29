#!/usr/bin/env sh
# Thin adapter: afterFileEdit -> agent-kit validate after-edit (advisory annotate).
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/resolve-agent-kit.sh"
if ! resolve_agent_kit; then
  printf '%s\n' '{}'
  exit 0
fi
# shellcheck disable=SC2086
exec $AGENT_KIT_RESOLVED validate after-edit
