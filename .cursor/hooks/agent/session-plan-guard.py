#!/usr/bin/env python3
"""sessionStart: inject plan/HANDOFF context and manual-mode hard stops."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


HARD_RULES = """
# Agent Kit session hard rules (manual mode default)

1. **One phase per chat.** Finish the current phase (or one to-do if the phase is huge), update `.cursor/HANDOFF.md`, then STOP and ask the user before starting the next phase.
2. **Do not burn the window.** Never run an entire multi-phase plan in one conversation unless the user explicitly ran `/run-plan` (or a deprecated alias `/run-plan-loop` / `/run-plan-orchestrated`).
3. **Context questions are not optional.** If the user asks about context / contexto / window size, run the context-guardian protocol: warn, offer handoff, do NOT dismiss with "it's fine" and keep coding.
4. **Read HANDOFF first** when resuming. Do not restart the plan from scratch.
5. **Git:** suggest `/git-staging` after a phase with a diff; never `/git-prod` without explicit confirmation.
6. **HITL slash commands win.** When waiting for confirmation on `/git-staging` or `/git-prod` (or similar), do not divert to continue-plan / phase-boundary chatter; stay on that routine until the user answers.
7. **`/start-project` is plan bootstrap, not execute.** Broad Intake Review first, then two gates: (A) single composite question (with active plan: backlog+write / park+write / modify / cancel; without: write / modify / cancel) — approve/write the plan file only, (B) approve the first unit. Goal text in the same message is NOT permission to edit product files. Never "create plan and start Phase 1" in one turn. If HANDOFF already has an active plan, disposition is merged into Gate A composite options; never park silently. Gates use Ask questions per `.cursor/rules/hitl-ask-questions.mdc`. Fallback: one numbered list per message.
8. **`/continue-plan` waits for yes.** Summarize next `[to-do-id]`, then stop until the user confirms before editing.
9. **`/run-plan-all` is a pure orchestrator.** After the confirm queue Ask, dispatch one Task subagent per plan (run the `/run-plan` tick contract inside it); never implement to-dos, run tests, or write changelogs in the orchestrator window.
10. **Backlog CRUD never activates.** `/backlog-add` enqueues (Broad Intake + write Ask + plan file + HANDOFF Backlog) without park, activate, or Gate B. `/backlog-edit` / `/backlog-delete` / `/backlog-cancel` require Ask confirm before mutate; delete archives from Backlog, cancel is soft in place. No Field Report cards for routine backlog CRUD.
11. **HANDOFF machine fields are bullet fields, not `##` headings.** Mission Control parses `- **Plan:**`, `- **Backlog plans:**`, `- **Parked plans:**`, `- **Run queue:**` (etc.). Canonical Plan: `- **Plan:** \`name.plan.md\`` or `none`. Nested backlog/parked rows: `- \`other.plan.md\``. Never invent `## Backlog plans` / `## Parked plans` / `## Run queue` headings in place of those fields (Checklist / Current mission go empty or idle).
""".strip()

DOGFOOD_INBOX_HINT = """
## Dogfood inbox

Unprocessed files are listed under `dogfood/README.md` (### Unprocessed Files). Follow the ingest ritual there (detect → analyze → memory WRITE → triage). Do not auto-start analysis unless the user asks.
""".strip()

UPDATE_CHECK_NUDGE = """
## Agent Kit update available

Installed **v{installed}**; latest public **v{latest}**.

This is an advisory only (no files were changed). To apply, run `/update` and confirm via Ask questions. Bare `agent-kit update` is an explicit operator invoke, not a background job.
""".strip()

_NONE_PLACEHOLDERS = frozenset({"none", "n/a", "empty", "nil"})


def read_text(path: Path, limit: int = 60) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    return "\n".join(lines[:limit]).strip()


def read_full_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def handoff_format_warnings(text: str) -> list[str]:
    """Heuristic: heading-only Backlog/Parked/Run queue breaks Mission Control parsers."""
    if not text.strip():
        return []
    warnings: list[str] = []
    checks = (
        ("Backlog plans", ("Backlog plans", "Backlog")),
        ("Parked plans", ("Parked plans",)),
        ("Run queue", ("Run queue",)),
    )
    for heading_label, field_labels in checks:
        heading_re = rf"(?m)^##\s+{heading_label}\s*$"
        if not re.search(heading_re, text):
            continue
        has_field = any(re.search(rf"(?m)^- \*\*{label}:\*\*", text) for label in field_labels)
        if not has_field:
            warnings.append(
                f"`## {heading_label}` found without `- **{field_labels[0]}:**` "
                "(Mission Control will miss this list; rewrite as a field bullet)."
            )
    return warnings


def l0_present(root: Path) -> bool:
    """True when Core Pack L0 artifacts are present in the workspace."""
    cursor = root / ".cursor"
    return (
        (cursor / "agent-kit.json").is_file()
        or (cursor / "commands" / "agent-kit-onboard.md").is_file()
        or (cursor / "commands" / "start-project.md").is_file()
    )


def _check_label_and_recommendation(check: dict) -> tuple[str, str] | None:
    """Prefer the first action id/recommendation; fall back to check id/title."""
    check_id = check.get("id")
    if not isinstance(check_id, str) or not check_id:
        return None
    actions = check.get("actions")
    if isinstance(actions, list):
        for action in actions:
            if not isinstance(action, dict):
                continue
            action_id = action.get("id")
            recommendation = action.get("recommendation")
            if isinstance(action_id, str) and isinstance(recommendation, str):
                return action_id, recommendation
    title = check.get("title")
    if isinstance(title, str) and title:
        return check_id, title
    return check_id, "Resolve this readiness check"


def unresolved_readiness_checks(data: dict) -> tuple[list[dict], list[dict]]:
    """Split unresolved pillar checks into essential vs non-essential (report order)."""
    essential: list[dict] = []
    nonessential: list[dict] = []
    pillars = data.get("pillars")
    if not isinstance(pillars, list):
        return essential, nonessential
    for pillar in pillars:
        if not isinstance(pillar, dict):
            continue
        checks = pillar.get("checks")
        if not isinstance(checks, list):
            continue
        for check in checks:
            if not isinstance(check, dict):
                continue
            if check.get("status") == "ready":
                continue
            if check.get("essential") is True:
                essential.append(check)
            else:
                nonessential.append(check)
    return essential, nonessential


def readiness_section(root: Path) -> str | None:
    """Surface the first unresolved readiness item; only essentials imply a planning stop."""
    snapshot_path = root / ".cursor" / "context" / "readiness.json"
    try:
        raw = snapshot_path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None

    essential, nonessential = unresolved_readiness_checks(data)
    if essential:
        labeled = _check_label_and_recommendation(essential[0])
        if labeled is None:
            return None
        action_id, recommendation = labeled
        return (
            "## Repository readiness\n\n"
            f"Unresolved essential check: `{action_id}`. {recommendation} "
            "Run `/agent-kit-onboard` before `/start-project`. "
            "An active plan or HANDOFF remains the current work and is not replaced."
        )
    if nonessential:
        labeled = _check_label_and_recommendation(nonessential[0])
        if labeled is None:
            return None
        action_id, recommendation = labeled
        return (
            "## Repository readiness\n\n"
            f"Optional readiness item: `{action_id}`. {recommendation} "
            "This does not block `/start-project` or active plan work. "
            "Resume later with `/agent-kit-onboard` if useful."
        )

    # Legacy snapshots without pillars: pendingActions are advisory only.
    actions = data.get("pendingActions")
    if not isinstance(actions, list) or not actions:
        return None
    first = actions[0]
    if not isinstance(first, dict):
        return None
    action_id = first.get("id")
    recommendation = first.get("recommendation")
    if not isinstance(action_id, str) or not isinstance(recommendation, str):
        return None
    return (
        "## Repository readiness\n\n"
        f"Optional readiness item: `{action_id}`. {recommendation} "
        "This does not block `/start-project` or active plan work. "
        "Resume later with `/agent-kit-onboard` if useful."
    )


def parse_unprocessed_dogfood_items(readme_text: str) -> list[str]:
    """File-like bullets from ### Unprocessed Files; empty when none / *None* only."""
    items: list[str] = []
    in_section = False
    for line in readme_text.splitlines():
        if line.startswith("### Unprocessed Files"):
            in_section = True
            continue
        if not in_section:
            continue
        if line.startswith("### "):
            break
        stripped = line.strip()
        if not stripped.startswith("- "):
            continue
        body = stripped[2:].strip()
        normalized = body.lower().strip("*_ ")
        if not normalized or normalized in _NONE_PLACEHOLDERS:
            continue
        items.append(body)
    return items


def dogfood_inbox_section(root: Path) -> str | None:
    """Hint when dogfood/ exists and the index lists unprocessed file bullets."""
    dogfood_dir = root / "dogfood"
    if not dogfood_dir.is_dir():
        return None
    readme = dogfood_dir / "README.md"
    if not readme.is_file():
        return None
    try:
        text = readme.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    if not parse_unprocessed_dogfood_items(text):
        return None
    return DOGFOOD_INBOX_HINT


def _load_update_check_prefs(root: Path) -> dict | None:
    """Return updateCheck object when enabled; None when opt-out or missing."""
    config_path = root / ".cursor" / "context" / "config.json"
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    uc = data.get("updateCheck")
    if not isinstance(uc, dict) or uc.get("enabled") is not True:
        return None
    return uc


def update_check_section(root: Path) -> str | None:
    """
    Opt-in sessionStart advisory when a newer public release exists.
    Never applies updates. Skips factory/dev via CLI check status.
    """
    import shutil
    import subprocess

    if _load_update_check_prefs(root) is None:
        return None

    agent_kit = shutil.which("agent-kit")
    if not agent_kit:
        return None

    try:
        proc = subprocess.run(
            [
                agent_kit,
                "update",
                "--check",
                "--json",
                "--respect-prefs",
                "--stamp",
                "--cwd",
                str(root),
            ],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None

    raw = (proc.stdout or "").strip()
    if not raw:
        return None
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(result, dict):
        return None
    if result.get("status") != "update-available":
        return None
    if result.get("applyRecommended") is True:
        # Defensive: check path must never recommend apply.
        return None
    installed = result.get("installedVersion") or "?"
    latest = result.get("latestVersion") or "?"
    return UPDATE_CHECK_NUDGE.format(installed=installed, latest=latest)


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}

    roots = payload.get("workspace_roots") or []
    root = Path(roots[0]) if roots else Path.cwd()

    handoff_path = root / ".cursor" / "HANDOFF.md"
    handoff_full = read_full_text(handoff_path)
    handoff = read_text(handoff_path)
    parts = [HARD_RULES]

    if l0_present(root):
        readiness = readiness_section(root)
        if readiness:
            parts.append(readiness)

    dogfood_hint = dogfood_inbox_section(root)
    if dogfood_hint:
        parts.append(dogfood_hint)

    update_nudge = update_check_section(root)
    if update_nudge:
        parts.append(update_nudge)

    format_warnings = handoff_format_warnings(handoff_full)
    if format_warnings:
        bullet = "\n".join(f"- {w}" for w in format_warnings)
        parts.append(
            "## HANDOFF format warning (Mission Control)\n\n"
            + bullet
            + "\n\nRewrite machine lists as `- **Field:**` bullets before trusting Checklist / Current mission."
        )

    if handoff:
        parts.append("## Current HANDOFF.md (excerpt)\n\n" + handoff)
    else:
        parts.append(
            "## HANDOFF.md\n\nNo handoff file yet. If starting work, create a plan with to-dos first (`/start-project`)."
        )

    print(json.dumps({"additional_context": "\n\n".join(parts)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
