#!/usr/bin/env python3
"""sessionStart: inject plan/HANDOFF context and manual-mode hard stops."""

from __future__ import annotations

import json
import sys
from pathlib import Path


HARD_RULES = """
# Agent Kit — session hard rules (manual mode default)

1. **One phase per chat.** Finish the current phase (or one to-do if the phase is huge), update `.cursor/HANDOFF.md`, then STOP and ask the user before starting the next phase.
2. **Do not burn the window.** Never run an entire multi-phase plan in one conversation unless the user explicitly ran `/run-plan-loop` or `/run-plan-orchestrated`.
3. **Context questions are not optional.** If the user asks about context / contexto / window size, run the context-guardian protocol: warn, offer handoff, do NOT dismiss with "it's fine" and keep coding.
4. **Read HANDOFF first** when resuming. Do not restart the plan from scratch.
5. **Git:** suggest `/git-staging` after a phase with a diff; never `/git-prod` without explicit confirmation.
6. **HITL slash commands win.** When waiting for confirmation on `/git-staging` or `/git-prod` (or similar), do not divert to continue-plan / phase-boundary chatter; stay on that routine until the user answers.
""".strip()



def read_text(path: Path, limit: int = 60) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    return "\n".join(lines[:limit]).strip()


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}

    roots = payload.get("workspace_roots") or []
    root = Path(roots[0]) if roots else Path.cwd()

    handoff = read_text(root / ".cursor" / "HANDOFF.md")
    parts = [HARD_RULES]
    if handoff:
        parts.append("## Current HANDOFF.md (excerpt)\n\n" + handoff)
    else:
        parts.append(
            "## HANDOFF.md\n\nNo handoff file yet. If starting work, create a plan with to-dos first (`/start-project`)."
        )

    print(json.dumps({"additional_context": "\n\n".join(parts)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
