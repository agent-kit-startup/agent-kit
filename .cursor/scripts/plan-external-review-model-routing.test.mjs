import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(repoRoot, ".cursor/scripts/plan-external-review.sh");
const SRC = readFileSync(SCRIPT, "utf8");

function extractFn(name) {
  const out = spawnSync("sed", ["-n", `/^${name}() {/,/^}$/p`, SCRIPT], { encoding: "utf8" });
  assert.ok(out.stdout.includes(`${name}()`), `failed to extract ${name}`);
  return out.stdout;
}

function runBash(body) {
  const fns = ["normalize_model_family", "models_same_family", "effective_reviewer_model"]
    .map(extractFn)
    .join("\n");
  const bash = `
set -euo pipefail
REVIEWER_BACKEND="\${REVIEWER_BACKEND:-claude}"
REVIEWER_MODEL="\${REVIEWER_MODEL:-haiku}"
${fns}
${body}
`;
  return spawnSync("bash", ["-c", bash], { encoding: "utf8" });
}

test("launcher model routing: Haiku spawn, escalate sentinel, same-model refuse", () => {
  assert.match(SRC, /--reviewer-model/);
  assert.match(SRC, /--advisor-model/);
  assert.match(SRC, /--implementer-model/);
  assert.match(SRC, /AGENT_KIT_AUDIT_IMPLEMENTER_MODEL/);
  assert.match(SRC, /--model "\$\{WAIT_REVIEWER_MODEL:-haiku\}"/);
  assert.match(SRC, /<!-- audits-advisor-escalate -->/);
  assert.match(SRC, /maybe_run_advisor/);
  assert.match(SRC, /enforce_implementer_reviewer_split/);
  assert.match(SRC, /findings-contract against the git delta/);
  assert.match(SRC, /This is not a silent self-review/);
});

test("normalize_model_family collapses vendor aliases", () => {
  const out = runBash(`
echo "$(normalize_model_family "")"
echo "$(normalize_model_family Auto)"
echo "$(normalize_model_family haiku)"
echo "$(normalize_model_family claude-haiku-4-5-20251001)"
echo "$(normalize_model_family claude-3-5-haiku-latest)"
echo "$(normalize_model_family opus)"
echo "$(normalize_model_family claude-opus-4-20250514)"
echo "$(normalize_model_family composer-2.5-fast)"
`);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(
    out.stdout.trim(),
    ["auto", "auto", "haiku", "haiku", "haiku", "opus", "opus", "composer"].join("\n"),
  );
});

test("models_same_family refuses Auto/Auto and Haiku/Haiku, allows Auto/Haiku", () => {
  const out = runBash(`
models_same_family auto Auto && echo auto-auto || echo auto-auto-no
models_same_family haiku claude-haiku-4-5 && echo haiku-haiku || echo haiku-haiku-no
models_same_family auto haiku && echo auto-haiku || echo auto-haiku-no
models_same_family sonnet opus && echo sonnet-opus || echo sonnet-opus-no
`);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(
    out.stdout.trim(),
    ["auto-auto", "haiku-haiku", "auto-haiku-no", "sonnet-opus-no"].join("\n"),
  );
});

test("effective_reviewer_model: Claude keeps haiku; Cursor Claude-family collapses to auto", () => {
  const claude = runBash(`
REVIEWER_BACKEND=claude
REVIEWER_MODEL=haiku
echo "$(effective_reviewer_model)"
`);
  assert.equal(claude.status, 0, claude.stderr);
  assert.equal(claude.stdout.trim(), "haiku");

  const cursorHaiku = runBash(`
REVIEWER_BACKEND=cursor
REVIEWER_MODEL=haiku
echo "$(effective_reviewer_model)"
`);
  assert.equal(cursorHaiku.status, 0, cursorHaiku.stderr);
  assert.equal(cursorHaiku.stdout.trim(), "auto");

  const cursorNamed = runBash(`
REVIEWER_BACKEND=cursor
REVIEWER_MODEL=composer-2.5-fast
echo "$(effective_reviewer_model)"
`);
  assert.equal(cursorNamed.status, 0, cursorNamed.stderr);
  assert.equal(cursorNamed.stdout.trim(), "composer-2.5-fast");
});
