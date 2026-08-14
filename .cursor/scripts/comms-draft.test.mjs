import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  draftId,
  main,
  parseArgs,
  redactSecrets,
  renderDraft,
  validate,
  writeDraft,
} from "./comms-draft.mjs";

test("publish flag fails closed", () => {
  const opts = parseArgs(["--publish", "--kind", "recap"]);
  assert.equal(opts.publish, true);
  const msg = validate(opts);
  assert.match(msg, /never posts/i);
});

test("main --publish exits 2 and writes nothing", () => {
  const room = mkdtempSync(join(tmpdir(), "ak-comms-"));
  try {
    const code = main(["--publish"], room);
    assert.equal(code, 2);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("unknown kind exits 1", () => {
  assert.equal(validate(parseArgs(["--kind", "ads"])), "unknown --kind ads");
});

test("renderDraft stays on 5.0.0 and dual-name install", () => {
  const d = renderDraft({ kind: "release", channel: "x", version: "5.0.0" }, "2026-08-13");
  assert.equal(d.id, draftId("release", "x", "2026-08-13"));
  assert.match(d.body, /@dadado\/agent-kit-cli@5\.0\.0/);
  assert.match(d.body, /missionkit\.io/);
  assert.equal(d.hitl, "pending");
  assert.doesNotMatch(d.body, /Marketplace listed/i);
});

test("redactSecrets strips assignment values", () => {
  const out = redactSecrets("MISSION_KIT_COMMS_X_BEARER=live-secret-value TOKEN=abc");
  assert.match(out, /<redacted>/);
  assert.doesNotMatch(out, /live-secret-value/);
  assert.doesNotMatch(out, /TOKEN=abc/);
});

test("writeDraft is idempotent unless force-new", () => {
  const room = mkdtempSync(join(tmpdir(), "ak-comms-"));
  try {
    const draft = renderDraft({ kind: "recap", channel: "x", version: "5.0.0" }, "2026-08-13");
    const a = writeDraft(room, draft);
    const b = writeDraft(room, draft);
    assert.equal(a.reused, false);
    assert.equal(b.reused, true);
    const c = writeDraft(room, { ...draft, body: "second" }, { forceNew: true });
    assert.equal(c.reused, false);
    const saved = JSON.parse(readFileSync(a.path, "utf8"));
    assert.equal(saved.body, "second");
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("direct module path is this file's sibling script", () => {
  assert.match(fileURLToPath(import.meta.url), /comms-draft\.test\.mjs$/);
});
