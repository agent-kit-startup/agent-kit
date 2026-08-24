import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
REVIEWER_MODEL="\${REVIEWER_MODEL:-sonnet}"
${fns}
${body}
`;
  return spawnSync("bash", ["-c", bash], { encoding: "utf8" });
}

function extractVarAssignment(name) {
  const out = spawnSync("grep", ["-m1", `^${name}=`, SCRIPT], { encoding: "utf8" });
  assert.ok(out.stdout.trim().length > 0, `failed to extract ${name}`);
  return out.stdout;
}

// Runs the real monitor_wants_advisor() from the script (plus its
// ADVISOR_ESCALATE_SENTINEL constant) against a scratch file, mirroring how
// maybe_run_advisor() gates the opus escalation.
function monitorWantsAdvisor(root, rel) {
  const prelude = [
    extractVarAssignment("ADVISOR_ESCALATE_SENTINEL"),
    extractFn("monitor_wants_advisor"),
  ].join("\n");
  const bash = `
set -euo pipefail
ROOT=${JSON.stringify(root)}
${prelude}
if monitor_wants_advisor ${JSON.stringify(rel)}; then echo yes; else echo no; fi
`;
  const out = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}

// Historical default at f27910a was Haiku; classifier-capable Sonnet is the post-amendment default.
test("launcher model routing: classifier-capable reviewer spawn, escalate sentinel, same-model refuse", () => {
  assert.match(SRC, /--reviewer-model/);
  assert.match(SRC, /--advisor-model/);
  assert.match(SRC, /--implementer-model/);
  assert.match(SRC, /AGENT_KIT_AUDIT_IMPLEMENTER_MODEL/);
  assert.match(SRC, /--model "\$\{WAIT_REVIEWER_MODEL:-sonnet\}"/);
  assert.match(SRC, /<!-- audits-advisor-escalate -->/);
  assert.match(SRC, /maybe_run_advisor/);
  assert.match(SRC, /enforce_implementer_reviewer_split/);
  assert.match(SRC, /findings-contract against the git delta/);
  assert.match(SRC, /This is not a silent self-review/);
});

test("monitor_wants_advisor: anchored to a standalone sentinel line, ignores prose/negated mentions", () => {
  const dir = mkdtempSync(join(tmpdir(), "audits-advisor-sentinel-"));
  try {
    const proseFile = "prose-negated.md";
    writeFileSync(
      join(dir, proseFile),
      [
        "**To-do:** Opus advisor only when monitor marks `<!-- audits-advisor-escalate -->`.",
        "Neither finding is high/critical severity; no `<!-- audits-advisor-escalate -->` needed.",
      ].join("\n"),
    );
    assert.equal(
      monitorWantsAdvisor(dir, proseFile),
      "no",
      "inline/negated prose mention of the sentinel must not trigger escalation",
    );

    const genuineFile = "genuine-escalate.md";
    writeFileSync(
      join(dir, genuineFile),
      ["## Advisor", "", "<!-- audits-advisor-escalate -->", ""].join("\n"),
    );
    assert.equal(
      monitorWantsAdvisor(dir, genuineFile),
      "yes",
      "a genuine standalone sentinel comment line must trigger escalation",
    );

    const indentedFile = "genuine-indented.md";
    writeFileSync(join(dir, indentedFile), "text\n   <!-- audits-advisor-escalate -->   \nmore\n");
    assert.equal(
      monitorWantsAdvisor(dir, indentedFile),
      "yes",
      "surrounding whitespace on an otherwise-standalone sentinel line must still trigger escalation",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("effective_reviewer_model: Claude default is sonnet; explicit haiku kept; Cursor Claude-family collapses to auto", () => {
  const claudeDefault = runBash(`
REVIEWER_BACKEND=claude
unset REVIEWER_MODEL
echo "$(effective_reviewer_model)"
`);
  assert.equal(claudeDefault.status, 0, claudeDefault.stderr);
  assert.equal(claudeDefault.stdout.trim(), "sonnet");

  const claudeHaiku = runBash(`
REVIEWER_BACKEND=claude
REVIEWER_MODEL=haiku
echo "$(effective_reviewer_model)"
`);
  assert.equal(claudeHaiku.status, 0, claudeHaiku.stderr);
  assert.equal(claudeHaiku.stdout.trim(), "haiku");

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
