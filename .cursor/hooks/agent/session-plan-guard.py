#!/usr/bin/env python3
"""sessionStart: inject plan/HANDOFF context and manual-mode hard stops."""

from __future__ import annotations

import json
import sys
from pathlib import Path


HARD_RULES = """
# Agent Kit — session hard rules (manual mode default)

1. **One phase per chat.** Finish the current phase (or one to-do if the phase is huge), update `.cursor/HANDOFF.md`, then STOP and ask the user before starting the next phase.
2. **Do not burn the window.** Never run an entire multi-phase plan in one conversation unless the user explicitly ran `/run-plan` (or a deprecated alias `/run-plan-loop` / `/run-plan-orchestrated`).
3. **Context questions are not optional.** If the user asks about context / contexto / window size, run the context-guardian protocol: warn, offer handoff, do NOT dismiss with "it's fine" and keep coding.
4. **Read HANDOFF first** when resuming. Do not restart the plan from scratch.
5. **Git:** suggest `/git-staging` after a phase with a diff; never `/git-prod` without explicit confirmation.
6. **HITL slash commands win.** When waiting for confirmation on `/git-staging` or `/git-prod` (or similar), do not divert to continue-plan / phase-boundary chatter; stay on that routine until the user answers.
7. **`/start-project` is plan bootstrap, not execute.** Broad Intake Review first, then two gates: (A) approve/write the plan file only, (B) approve the first unit. Goal text in the same message is NOT permission to edit product files. Never "create plan and start Phase 1" in one turn. If HANDOFF already has an active plan, park it and proceed. Gates use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`.
8. **`/continue-plan` waits for yes.** Summarize next `[to-do-id]`, then stop until the user confirms before editing.
""".strip()

FIRST_SESSION_NUDGE = """
## First session

Agent Kit L0 is installed but onboarding has not run (`onboarded` marker missing). Offer or run `/onboard` before other work (welcome + Ask questions). Do not skip to coding. `/onboard` does not write plan files; plan bootstrap is `/start-project`.
""".strip()


def read_text(path: Path, limit: int = 60) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    return "\n".join(lines[:limit]).strip()


def l0_present(root: Path) -> bool:
    """True when Core Pack L0 artifacts are present in the workspace."""
    cursor = root / ".cursor"
    return (
        (cursor / "agent-kit.json").is_file()
        or (cursor / "commands" / "onboard.md").is_file()
        or (cursor / "commands" / "start-project.md").is_file()
    )


def is_onboarded(root: Path) -> bool:
    """True when `.cursor/context/config.json` has `"onboarded": true`."""
    config_path = root / ".cursor" / "context" / "config.json"
    try:
        raw = config_path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return False
    if not isinstance(data, dict):
        return False
    return data.get("onboarded") is True


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

    if l0_present(root) and not is_onboarded(root):
        parts.append(FIRST_SESSION_NUDGE)

    if handoff:
        parts.append("## Current HANDOFF.md (excerpt)\n\n" + handoff)
    else:
        parts.append(
            "## HANDOFF.md\n\nNo handoff file yet. If starting work, create a plan with to-dos first (`/start-project`)."
        )

    print(json.dumps({"additional_context": "\n\n".join(parts)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
