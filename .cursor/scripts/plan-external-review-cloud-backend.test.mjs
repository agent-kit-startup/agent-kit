// backend=cloud (Cursor Cloud Agents) contract asserts against the launcher source.
// Source-string asserts only: these tests never call the Cursor REST API and never read
// CURSOR_API_KEY. Spending an operator's key from a test suite is not acceptable.
// ADR: .cursor/memory/decisions/2026-08-14_cursor-cloud-agents-sdk-audits-backend.md
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = resolve(ROOT, ".cursor/scripts/plan-external-review.sh");
const SRC = readFileSync(SCRIPT, "utf8");

test("cloud is an accepted --backend value in both usage messages", () => {
  assert.match(SRC, /--backend requires auto\|claude\|cursor\|cloud/);
  assert.match(SRC, /--backend must be auto, claude, cursor, or cloud/);
  assert.match(SRC, /"\$2" != "cloud"/);
});

test("config allow-list accepts cloud; unknown values still fall back to claude", () => {
  assert.match(SRC, /const ok = \["auto", "cursor", "claude", "cloud"\];/);
  assert.match(SRC, /ok\.includes\(v\) \? v : "claude"/);
});

test("cloud is a pin only: resolve has an explicit case and auto never cascades into it", () => {
  assert.match(SRC, /cloud\)\n\s+if cloud_usable; then\n\s+REVIEWER_BACKEND="cloud"/);
  // The auto branch must still be Claude -> cursor-agent -> none, with no cloud step.
  const autoBranch = SRC.slice(
    SRC.indexOf("    auto)"),
    SRC.indexOf("    *)\n      if claude_usable"),
  );
  assert.ok(autoBranch.length > 0, "auto branch not found");
  assert.doesNotMatch(autoBranch, /cloud/);
});

test("cloud_usable requires curl, node, and a non-empty CURSOR_API_KEY", () => {
  assert.match(SRC, /cloud_usable\(\) \{/);
  assert.match(SRC, /command -v curl >\/dev\/null 2>&1 \|\| return 1/);
  assert.match(SRC, /\[\[ -n "\$\{CURSOR_API_KEY:-\}" \]\]/);
});

test("the API key never reaches argv: curl reads its auth header from stdin config", () => {
  assert.match(SRC, /-K -\)/);
  assert.match(SRC, /printf 'header = "Authorization: Bearer %s"\\n' "\$\{CURSOR_API_KEY:-\}"/);
  // -u KEY: would expose the key in `ps` output.
  assert.doesNotMatch(SRC, /curl[^\n]*-u "\$\{?CURSOR_API_KEY/);
  // No secret may be echoed or interpolated into a printed/pasteable command.
  assert.doesNotMatch(SRC, /VISIBLE_CMD[^\n]*CURSOR_API_KEY/);
  assert.doesNotMatch(SRC, /echo[^\n]*\$CURSOR_API_KEY/);
});

test("findings-only: the create body hard-codes autoCreatePR and workOnCurrentBranch false", () => {
  assert.match(SRC, /autoCreatePR: false,/);
  assert.match(SRC, /workOnCurrentBranch: false,/);
  // Neither may be sourced from config: they are not operator-tunable.
  assert.doesNotMatch(SRC, /config_cloud_string autoCreatePR/);
  assert.doesNotMatch(SRC, /config_cloud_string workOnCurrentBranch/);
});

test("pushed-state preflight guards against auditing stale state, without fetching", () => {
  assert.match(SRC, /cloud_pushed_state_ok\(\) \{/);
  assert.match(SRC, /merge-base --is-ancestor HEAD "\$upstream"/);
  assert.doesNotMatch(SRC, /git -C "\$ROOT" fetch/);
  assert.match(
    SRC,
    /if \[\[ "\$REVIEWER_BACKEND" == "cloud" \]\] && ! cloud_pushed_state_ok; then\n\s+soft_fail_exit/,
  );
});

test("wait-state carries the cloud handles for an exit-3 resume, and no key", () => {
  assert.match(SRC, /out\.cloudAgentId = process\.argv\[9\]/);
  assert.match(SRC, /out\.cloudRunId = process\.argv\[10\]/);
  assert.match(SRC, /WAIT_CLOUD_AGENT_ID="\$agent_id"/);
  // The persisted wait-state holds ids, timestamps, and model names only.
  const writer = SRC.slice(
    SRC.indexOf("wait_state_write() {"),
    SRC.indexOf("wait_state_clear() {"),
  );
  assert.doesNotMatch(writer, /CURSOR_API_KEY|apiKey|token|secret/i);
});

test("run status maps to the existing exit contract and never fabricates a monitor", () => {
  assert.match(SRC, /FINISHED\)\n\s+break/);
  assert.match(SRC, /ERROR\|CANCELLED\|EXPIRED\)/);
  assert.match(SRC, /RAN AND FAILED/);
  assert.match(SRC, /NEVER STARTED/);
  assert.match(SRC, /refusing to write an empty monitor/);
  assert.match(SRC, /exit 3/);
  assert.match(SRC, /audits-wait-fresh: created/);
});

test("cloud skips the PTY machinery and refuses --batch honestly", () => {
  const branch = SRC.slice(
    SRC.indexOf('if [[ "$REVIEWER_BACKEND" == "cloud" && "$MODE" != "paste-only"'),
  );
  assert.match(branch, /cloud_review_run "\$SINGLE_MONITOR_PATH"/);
  assert.match(SRC, /backend=cloud does not support --batch yet/);
  // The cloud runner itself must not reach for tmux/screen concepts.
  const runner = SRC.slice(
    SRC.indexOf("cloud_review_run() {"),
    SRC.indexOf("build_batch_prompt() {"),
  );
  assert.doesNotMatch(
    runner,
    /launch_background_terminal|wait_for_pty_progress|audit_session_pressure_gate/,
  );
});

test("cloud output contract tells the reviewer not to branch, commit, push, or open a PR", () => {
  assert.match(SRC, /build_cloud_prompt\(\) \{/);
  assert.match(SRC, /Do NOT create a branch, commit, push, or open a pull request/);
  assert.match(SRC, /Your FINAL message must be the complete monitor markdown/);
});

// Plan files are gitignored session state, so a clean CI checkout has none. Skip the
// end-to-end dry-run there rather than asserting against a file that cannot exist.
const PLAN_REL = ".cursor/plans/cursor-cloud-agents-sdk.plan.md";
test(
  "dry-run previews the cloud path without spending the key or the API",
  { skip: !existsSync(resolve(ROOT, PLAN_REL)) && "plan file absent (gitignored session state)" },
  () => {
    const out = execFileSync(
      "bash",
      [SCRIPT, "--force", "--backend", "cloud", "--dry-run", "cursor-cloud-agents-sdk.plan.md"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, CURSOR_API_KEY: "placeholder-not-a-real-key" },
      },
    );
    assert.match(out, /reviewer-backend: cloud/);
    assert.match(out, /cloud-api-base: https:\/\/api\.cursor\.com/);
    assert.match(out, /cloud-write-switches: autoCreatePR=false workOnCurrentBranch=false/);
    assert.match(out, /cloud-pushed-state:/);
    assert.doesNotMatch(out, /placeholder-not-a-real-key/);
  },
);
