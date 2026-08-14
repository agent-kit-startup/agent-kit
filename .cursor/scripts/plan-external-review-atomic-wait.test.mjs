import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runBash(room, body) {
  const fns = [
    "is_headless_env",
    "slug_from_monitor_path",
    "wait_state_path",
    "wait_state_get",
    "wait_state_write",
    "wait_state_clear",
    "wait_state_is_resumable",
    "wait_state_load_or_init",
    "wait_effective_timeout",
    "wait_state_finish",
    "file_mtime_epoch",
    "monitor_is_fresh",
  ]
    .map(extractFn)
    .join("\n");
  const bash = `
set -euo pipefail
ROOT=${JSON.stringify(room)}
WAIT_TIMEOUT=40
WAIT_TIMEOUT_EXPLICIT=1
WAIT_SLICE=2
WAIT_SLICE_EXPLICIT=1
WAIT_ARM_EPOCH=""
WAIT_DEADLINE=""
WAIT_REMAINING=""
WAIT_RESUME=0
WAIT_STATE_DIR_REL=".cursor/context/audit-wait"
WAIT_BACKEND_STAMP="claude"
WAIT_IMPLEMENTER_MODEL=""
WAIT_REVIEWER_MODEL=""
DRY_RUN=0
unset CI GITHUB_ACTIONS GITLAB_CI AGENT_KIT_HEADLESS
MOCK_TIME=1000
date() { echo "\$MOCK_TIME"; }
${fns}
${body}
`;
  return spawnSync("bash", ["-c", bash], { encoding: "utf8" });
}

function makeRoom() {
  const room = mkdtempSync(join(tmpdir(), "ak-atomic-wait."));
  mkdirSync(join(room, ".cursor/memory"), { recursive: true });
  mkdirSync(join(room, ".cursor/context/audit-wait"), { recursive: true });
  return room;
}

test("launcher wait_for_monitors uses persisted state and slice timeout", () => {
  assert.match(SRC, /wait_state_load_or_init/);
  assert.match(SRC, /wait_effective_timeout/);
  assert.match(SRC, /wait_state_finish ready/);
  assert.match(SRC, /wait_state_finish timeout/);
  assert.match(SRC, /WAIT_STATE_DIR_REL="\.cursor\/context\/audit-wait"/);
  assert.match(SRC, /--wait-slice/);
  assert.match(SRC, /waitSliceSeconds/);
});

test("wait_effective_timeout uses the chat slice when remaining is larger", () => {
  const room = makeRoom();
  try {
    const result = runBash(
      room,
      `
WAIT_REMAINING=900
WAIT_SLICE=90
WAIT_SLICE_EXPLICIT=1
echo "effective=$(wait_effective_timeout)"
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /effective=90/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("early-ready: sentinel monitor is fresh and finish ready clears wait-state", () => {
  const room = makeRoom();
  try {
    writeFileSync(
      join(room, ".cursor/memory/plan-monitor-a.md"),
      "<!-- audits-wait-fresh: created -->\n# ready\n",
    );
    const result = runBash(
      room,
      `
wait_state_load_or_init ".cursor/memory/plan-monitor-a.md"
if monitor_is_fresh ".cursor/memory/plan-monitor-a.md"; then
  echo "fresh=yes"
  wait_state_finish ready ".cursor/memory/plan-monitor-a.md"
else
  echo "fresh=no"
  exit 1
fi
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /fresh=yes/);
    assert.equal(existsSync(join(room, ".cursor/context/audit-wait/a.json")), false);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("slice timeout persists remaining budget outside HANDOFF", () => {
  const room = makeRoom();
  try {
    const result = runBash(
      room,
      `
wait_state_load_or_init ".cursor/memory/plan-monitor-a.md"
echo "effective=$(wait_effective_timeout) remaining=$WAIT_REMAINING"
wait_state_finish timeout ".cursor/memory/plan-monitor-a.md"
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /effective=2/);
    assert.match(result.stdout, /wait-slice timeout \(remaining=\d+s/);
    const state = JSON.parse(readFileSync(join(room, ".cursor/context/audit-wait/a.json"), "utf8"));
    assert.equal(state.status, "armed");
    assert.ok(state.remainingBudgetSeconds >= 30, JSON.stringify(state));
    assert.ok(state.remainingBudgetSeconds <= 40, JSON.stringify(state));
    assert.equal(state.backend, "claude");
    assert.ok(!("token" in state) && !("secret" in state));
    assert.equal(existsSync(join(room, ".cursor/HANDOFF.md")), false);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("resume loads stored epoch and remaining instead of restarting 900s", () => {
  const room = makeRoom();
  try {
    writeFileSync(
      join(room, ".cursor/context/audit-wait/a.json"),
      JSON.stringify({
        armEpoch: 990,
        deadline: 1002,
        remainingBudgetSeconds: 2,
        backend: "claude",
        implementerModel: "",
        reviewerModel: "",
        status: "armed",
      }),
    );
    const result = runBash(
      room,
      `
WAIT_TIMEOUT=900
WAIT_SLICE=90
wait_state_load_or_init ".cursor/memory/plan-monitor-a.md"
echo "resume=$WAIT_RESUME remaining=$WAIT_REMAINING epoch=$WAIT_ARM_EPOCH effective=$(wait_effective_timeout)"
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /wait-state resume/);
    assert.match(result.stdout, /resume=1 remaining=2 epoch=990 effective=2/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});
