#!/usr/bin/env python3
"""Stdlib unit checks for dogfood inbox parsing in session-plan-guard."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


def _load_guard():
    path = Path(__file__).with_name("session-plan-guard.py")
    spec = importlib.util.spec_from_file_location("session_plan_guard", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


guard = _load_guard()
parse_unprocessed_dogfood_items = guard.parse_unprocessed_dogfood_items
dogfood_inbox_section = guard.dogfood_inbox_section
DOGFOOD_INBOX_HINT = guard.DOGFOOD_INBOX_HINT
readiness_section = guard.readiness_section


class ParseUnprocessedDogfoodItemsTests(unittest.TestCase):
    def test_none_placeholder_yields_empty(self) -> None:
        text = """
### Unprocessed Files

*None*

### Processed Files

- `done.md`
"""
        self.assertEqual(parse_unprocessed_dogfood_items(text), [])

    def test_file_bullets_collected(self) -> None:
        text = """
### Unprocessed Files

- `cursor_a.md` - notes
- `cursor_b.md`

### Processed Files

- `old.md`
"""
        self.assertEqual(
            parse_unprocessed_dogfood_items(text),
            ["`cursor_a.md` - notes", "`cursor_b.md`"],
        )

    def test_dash_none_bullet_skipped(self) -> None:
        text = """
### Unprocessed Files

- *None*
"""
        self.assertEqual(parse_unprocessed_dogfood_items(text), [])

    def test_missing_section_yields_empty(self) -> None:
        self.assertEqual(parse_unprocessed_dogfood_items("# No section\n"), [])


class DogfoodInboxSectionTests(unittest.TestCase):
    def test_no_dogfood_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(dogfood_inbox_section(Path(tmp)))

    def test_unprocessed_emits_hint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dogfood = root / "dogfood"
            dogfood.mkdir()
            (dogfood / "README.md").write_text(
                "### Unprocessed Files\n\n- `new.md`\n\n### Processed Files\n\n*None*\n",
                encoding="utf-8",
            )
            self.assertEqual(dogfood_inbox_section(root), DOGFOOD_INBOX_HINT)

    def test_empty_index_no_hint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dogfood = root / "dogfood"
            dogfood.mkdir()
            (dogfood / "README.md").write_text(
                "### Unprocessed Files\n\n*None*\n\n### Processed Files\n\n- `x.md`\n",
                encoding="utf-8",
            )
            self.assertIsNone(dogfood_inbox_section(root))


class ReadinessSectionTests(unittest.TestCase):
    def test_missing_onboarded_marker_without_snapshot_does_not_nudge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(readiness_section(Path(tmp)))

    def test_first_pending_action_is_resumed_exactly(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            context = root / ".cursor" / "context"
            context.mkdir(parents=True)
            (context / "readiness.json").write_text(
                """{
  "pendingActions": [
    {"id": "git.provider", "recommendation": "Confirm the remote provider."},
    {"id": "git.staging", "recommendation": "Choose a staging strategy."}
  ]
}
""",
                encoding="utf-8",
            )

            section = readiness_section(root)

            self.assertIsNotNone(section)
            self.assertIn("`git.provider`", section)
            self.assertIn("Confirm the remote provider.", section)
            self.assertNotIn("git.staging", section)
            self.assertIn("active plan or HANDOFF", section)

    def test_ready_snapshot_does_not_nudge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            context = root / ".cursor" / "context"
            context.mkdir(parents=True)
            (context / "readiness.json").write_text(
                '{"pendingActions": []}\n',
                encoding="utf-8",
            )
            self.assertIsNone(readiness_section(root))


if __name__ == "__main__":
    unittest.main()
