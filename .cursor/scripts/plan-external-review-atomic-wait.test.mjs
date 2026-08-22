import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    "wait_state_expire_if_dead",
    "gc_wait_state_sweep",
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

function writeWaitState(room, slug, state) {
  writeFileSync(
    join(room, ".cursor/context/audit-wait", `${slug}.json`),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

function readWaitState(room, slug) {
  return JSON.parse(readFileSync(join(room, ".cursor/context/audit-wait", `${slug}.json`), "utf8"));
}

// Full-binary sandbox for CLI/env-var pure-sweep-mode tests: the launcher resolves ROOT
// from its own path ($(dirname "$0")/../..), so copying it under a temp room's
// .cursor/scripts/ makes ROOT resolve to that room instead of the real repo checkout -
// gc_wait_state_sweep() then only ever touches synthetic files, never the real
// .cursor/context/audit-wait/*.json state.
function makeScriptRoom() {
  const room = mkdtempSync(join(tmpdir(), "ak-gc-cli."));
  mkdirSync(join(room, ".cursor/scripts"), { recursive: true });
  mkdirSync(join(room, ".cursor/context/audit-wait"), { recursive: true });
  mkdirSync(join(room, ".cursor/context/templates"), { recursive: true });
  // Required by the pre-pure-mode gates: config_enabled is bypassed with --force, but the
  // template-existence check runs unconditionally before either pure-mode block.
  writeFileSync(join(room, ".cursor/context/templates/plan-external-review-prompt.md"), "stub\n");
  const script = join(room, ".cursor/scripts/plan-external-review.sh");
  writeFileSync(script, SRC);
  chmodSync(script, 0o755);
  return { room, script };
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

test("wait_state_expire_if_dead: armed past deadline is expired in place, other fields survive", () => {
  const room = makeRoom();
  try {
    writeWaitState(room, "a", {
      armEpoch: 900,
      deadline: 990,
      remainingBudgetSeconds: 90,
      backend: "cursor",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    const result = runBash(
      room,
      `
wait_state_expire_if_dead "a"
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /audits: wait-state expired a \(armed past deadline; dead arm, not live budget\)/,
    );
    const state = readWaitState(room, "a");
    assert.equal(state.status, "timeout");
    assert.equal(state.remainingBudgetSeconds, 0);
    assert.equal(state.armEpoch, 900);
    assert.equal(state.deadline, 990);
    assert.equal(state.backend, "cursor");
    assert.equal(state.implementerModel, "auto");
    assert.equal(state.reviewerModel, "sonnet");
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("wait_state_expire_if_dead: live armed file (now < deadline) is untouched and still resumable", () => {
  const room = makeRoom();
  try {
    writeWaitState(room, "a", {
      armEpoch: 900,
      deadline: 2000,
      remainingBudgetSeconds: 1000,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    const before = readWaitState(room, "a");
    const result = runBash(
      room,
      `
wait_state_expire_if_dead "a"
if wait_state_is_resumable "a"; then
  echo "resumable=yes"
else
  echo "resumable=no"
fi
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), "resumable=yes");
    const after = readWaitState(room, "a");
    assert.deepEqual(after, before);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("wait_state_expire_if_dead: already-timeout file is not rewritten (no spurious churn)", () => {
  const room = makeRoom();
  try {
    writeWaitState(room, "a", {
      armEpoch: 100,
      deadline: 200,
      remainingBudgetSeconds: 0,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "timeout",
    });
    const before = readWaitState(room, "a");
    const result = runBash(
      room,
      `
wait_state_expire_if_dead "a"
echo "done"
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), "done");
    assert.doesNotMatch(result.stdout, /wait-state expired/);
    const after = readWaitState(room, "a");
    assert.deepEqual(after, before);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("wait_state_expire_if_dead: DRY_RUN=1 previews and does not modify the file on disk", () => {
  const room = makeRoom();
  try {
    writeWaitState(room, "a", {
      armEpoch: 900,
      deadline: 990,
      remainingBudgetSeconds: 90,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    const before = readWaitState(room, "a");
    const result = runBash(
      room,
      `
DRY_RUN=1
wait_state_expire_if_dead "a"
`,
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /audits: wait-state would expire a/);
    assert.doesNotMatch(result.stdout, /audits: wait-state expired a /);
    const after = readWaitState(room, "a");
    assert.deepEqual(after, before);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("gc_wait_state_sweep: expires dead armed, skips live armed, skips already-terminal, one line each", () => {
  const room = makeRoom();
  try {
    writeWaitState(room, "live", {
      armEpoch: 900,
      deadline: 2000,
      remainingBudgetSeconds: 1000,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    writeWaitState(room, "dead", {
      armEpoch: 400,
      deadline: 500,
      remainingBudgetSeconds: 100,
      backend: "cursor",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    writeWaitState(room, "term", {
      armEpoch: 100,
      deadline: 200,
      remainingBudgetSeconds: 0,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "timeout",
    });
    const result = runBash(room, "gc_wait_state_sweep");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /gc-wait-state skip live \(armed; live budget, not past deadline\)/,
    );
    assert.match(result.stdout, /gc-wait-state skip term \(status: timeout; already terminal\)/);
    assert.match(
      result.stdout,
      /wait-state expired dead \(armed past deadline; dead arm, not live budget\)/,
    );
    assert.equal(readWaitState(room, "live").status, "armed");
    assert.equal(readWaitState(room, "term").status, "timeout");
    const dead = readWaitState(room, "dead");
    assert.equal(dead.status, "timeout");
    assert.equal(dead.remainingBudgetSeconds, 0);
    assert.equal(dead.backend, "cursor");
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("gc_wait_state_sweep: empty audit-wait directory reports no files and exits 0", () => {
  const room = makeRoom();
  try {
    const result = runBash(room, "gc_wait_state_sweep");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      /gc-wait-state found no \.cursor\/context\/audit-wait\/\*\.json files/,
    );
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("--gc-wait-state --dry-run (CLI, no plan arg): previews every file, writes nothing, exits 0", () => {
  const { room, script } = makeScriptRoom();
  try {
    writeWaitState(room, "dead", {
      armEpoch: 1,
      deadline: 2,
      remainingBudgetSeconds: 50,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    const before = readWaitState(room, "dead");
    const out = execFileSync("bash", [script, "--force", "--gc-wait-state", "--dry-run"], {
      cwd: room,
      encoding: "utf8",
    });
    assert.match(
      out,
      /audits: gc-wait-state dry-run preview \(no plan argument; no audit will start\)/,
    );
    assert.match(out, /wait-state would expire dead/);
    assert.deepEqual(readWaitState(room, "dead"), before);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("--gc-wait-state (CLI, no plan arg, no --dry-run): actually expires the dead file on disk", () => {
  const { room, script } = makeScriptRoom();
  try {
    writeWaitState(room, "dead", {
      armEpoch: 1,
      deadline: 2,
      remainingBudgetSeconds: 50,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    const out = execFileSync("bash", [script, "--force", "--gc-wait-state"], {
      cwd: room,
      encoding: "utf8",
    });
    assert.match(out, /audits: gc-wait-state mode \(no plan argument; no audit will start\)/);
    assert.match(out, /wait-state expired dead/);
    const after = readWaitState(room, "dead");
    assert.equal(after.status, "timeout");
    assert.equal(after.remainingBudgetSeconds, 0);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("AGENT_KIT_AUDIT_GC_WAIT_STATE=1 (env var, no flag, no plan arg): same pure-sweep exit-0 mode", () => {
  const { room, script } = makeScriptRoom();
  try {
    writeWaitState(room, "dead", {
      armEpoch: 1,
      deadline: 2,
      remainingBudgetSeconds: 50,
      backend: "claude",
      implementerModel: "auto",
      reviewerModel: "sonnet",
      status: "armed",
    });
    const out = execFileSync("bash", [script, "--force"], {
      cwd: room,
      encoding: "utf8",
      env: { ...process.env, AGENT_KIT_AUDIT_GC_WAIT_STATE: "1" },
    });
    assert.match(out, /audits: gc-wait-state mode \(no plan argument; no audit will start\)/);
    assert.match(out, /wait-state expired dead/);
    assert.equal(readWaitState(room, "dead").status, "timeout");
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("--gc-wait-state combined with a plan argument is a documented no-op (locks in current behavior)", () => {
  // Regression guard for the residual this fixes: the usage synopsis used to promise
  // `--gc-wait-state [--dry-run] [plan]`, but GC_WAIT_STATE is only ever consulted in the
  // two zero-PLAN_ARGS pure-exit blocks. Combined with a plan argument the flag parses
  // without error but never sweeps - this test locks that in so a future change either
  // fixes it deliberately (and updates this test) or the header comment stays accurate.
  assert.doesNotMatch(SRC, /gc-wait-state \[--dry-run\] \[plan\]/);
  const pureModeBlock = SRC.slice(
    SRC.indexOf('if [[ "$GC_WAIT_STATE" -eq 1 && "$BATCH" -eq 0'),
    SRC.indexOf('if [[ "$GC_WAIT_STATE" -eq 1 && "$BATCH" -eq 0') + 400,
  );
  assert.match(pureModeBlock, /\$\{#PLAN_ARGS\[@\]\}"\s*-eq 0/);
  assert.equal(
    (SRC.match(/gc_wait_state_sweep/g) || []).length > 0,
    true,
    "gc_wait_state_sweep must still exist and be called somewhere",
  );
});
