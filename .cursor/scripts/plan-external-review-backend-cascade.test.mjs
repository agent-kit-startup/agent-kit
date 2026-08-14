import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
  ".cursor/scripts/plan-external-review.sh",
);
const SRC = readFileSync(SCRIPT, "utf8");

test("launcher cascade: auto prefers Claude, else cursor-agent", () => {
  assert.match(SRC, /resolve_reviewer_backend/);
  assert.match(SRC, /AGENT_KIT_AUDIT_CLAUDE_QUOTA_EMPTY/);
  assert.match(SRC, /cursor-agent -p --force --sandbox disabled/);
  assert.match(SRC, /--backend auto\|claude\|cursor/);
  assert.match(SRC, /tip_no_reviewer/);
  assert.match(SRC, /This is not a Cursor tick API\/usage-limit hard-stop/);
});

test("pinned claude does not share the auto fallback path", () => {
  assert.match(SRC, /backend=claude is pinned/);
  assert.match(SRC, /REVIEWER_BACKEND" == "none"/);
});
