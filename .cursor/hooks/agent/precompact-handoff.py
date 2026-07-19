#!/usr/bin/env python3
"""preCompact: surface a handoff hint when Cursor compacts context."""

from __future__ import annotations

import json
import sys


def main() -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}

    pct = payload.get("context_usage_percent")
    trigger = payload.get("trigger") or "auto"
    pct_txt = f"~{pct}%" if pct is not None else "high"

    msg = (
        f"Context compacting ({trigger}, usage {pct_txt}). "
        "Update `.cursor/HANDOFF.md` and open a new chat with `/continue-plan` "
        "so the next agent starts fresh."
    )
    print(json.dumps({"user_message": msg}, ensure_ascii=False))


if __name__ == "__main__":
    main()
