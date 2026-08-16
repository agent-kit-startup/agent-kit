import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCRIPT = join(ROOT, ".cursor/scripts/plan-external-review.sh");

function extractFunction() {
  return spawnSync("sed", ["-n", "/^wait_for_pty_progress() {/,/^}$/p", SCRIPT], {
    encoding: "utf8",
  }).stdout;
}

function runGate({ bytesSequence, aliveSequence = [], timeout = 10, channel = "test" }) {
  const fn = extractFunction();
  const aliveArray = aliveSequence.length > 0 ? aliveSequence : [1];
  const bash = `
PROGRESS_TIMEOUT=${timeout}
MOCK_BYTES=(${bytesSequence.join(" ")})
MOCK_ALIVE=(${aliveArray.join(" ")})
MOCK_TIME=0
BYTES_CTR="$(mktemp)"
ALIVE_CTR="$(mktemp)"
echo 0 > "$BYTES_CTR"
echo 0 > "$ALIVE_CTR"
trap 'rm -f "$BYTES_CTR" "$ALIVE_CTR"' EXIT

pty_scrollback_bytes() {
  local idx val
  idx="$(cat "$BYTES_CTR")"
  val="\${MOCK_BYTES[$idx]:-0}"
  echo $((idx + 1)) > "$BYTES_CTR"
  echo "$val"
}

pty_session_alive() {
  local idx val
  idx="$(cat "$ALIVE_CTR")"
  val="\${MOCK_ALIVE[$idx]:-1}"
  echo $((idx + 1)) > "$ALIVE_CTR"
  return "$((1 - val))"
}

sleep() {
  local n="$1"
  if [[ -z "$n" || ! "$n" =~ ^[0-9]+$ ]]; then n=0; fi
  MOCK_TIME=$((MOCK_TIME + n))
}

date() {
  echo "$MOCK_TIME"
}

${fn}

wait_for_pty_progress "${channel}" "test-session"
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  return { output: result.stdout, exitCode: result.status ?? 1 };
}

test("banner appears within baseline window and growth passes gate", () => {
  const { output, exitCode } = runGate({
    bytesSequence: [0, 100, 200],
    timeout: 10,
  });
  assert.strictEqual(exitCode, 0, output);
  assert.match(output, /audits: progress gate passed/);
  assert.match(output, /scrollback grew from 100 to 200 bytes/);
});

test("banner never appears within 7s baseline deadline -> fail with banner message", () => {
  const { output, exitCode } = runGate({
    bytesSequence: [0, 0, 0, 0, 0, 0, 0],
    timeout: 10,
  });
  assert.strictEqual(exitCode, 1, output);
  assert.match(output, /audits: progress gate failed \(launcher banner did not appear\)/);
  assert.doesNotMatch(output, /scrollback grew/);
});

test("banner appears but no growth beyond threshold -> timeout failure", () => {
  const { output, exitCode } = runGate({
    bytesSequence: [0, 100, 100, 100, 100, 100, 100],
    timeout: 6,
  });
  assert.strictEqual(exitCode, 1, output);
  assert.match(output, /audits: progress gate failed \(no growth beyond launcher banner after/);
  assert.match(output, /baseline=100, current=100/);
});

test("session vanishes before growth -> fail with vanish message", () => {
  const { output, exitCode } = runGate({
    bytesSequence: [0, 100, 100],
    aliveSequence: [1, 1, 0],
    timeout: 60,
  });
  assert.strictEqual(exitCode, 1, output);
  assert.match(
    output,
    /audits: progress gate failed \(session test-session vanished before producing output\)/,
  );
});

test("unknown channel skips gate gracefully", () => {
  const { output, exitCode } = runGate({
    bytesSequence: [-1],
    channel: "unknown",
    timeout: 10,
  });
  assert.strictEqual(exitCode, 0, output);
  assert.match(output, /audits: progress gate skipped \(channel: unknown; no scrollback API\)/);
});

test("disabled gate returns immediately", () => {
  const fn = extractFunction();
  const bash = `
PROGRESS_TIMEOUT=0
${fn}
wait_for_pty_progress "screen" "test-session"
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  assert.strictEqual(result.status ?? 1, 0, result.stdout);
  assert.match(
    result.stdout,
    /audits: progress gate disabled \(AGENT_KIT_AUDIT_PROGRESS_TIMEOUT=0\)/,
  );
});

function extractSuffix() {
  return spawnSync("sed", ["-n", "/^audit_kit_suffix() {/,/^}$/p", SCRIPT], {
    encoding: "utf8",
  }).stdout;
}

test("heartbeat lines keep status prefixes; suffix is empty under CI", () => {
  const src = spawnSync("cat", [SCRIPT], { encoding: "utf8" }).stdout;
  assert.match(src, /audit_kit_suffix\(\)/);
  assert.match(src, /audits: progress gate still silent beyond banner/);
  assert.match(src, /audits: wait-monitor still waiting/);
  assert.match(src, /audits: wait-monitor timeout after \$\{elapsed\}s \(exit 3\)/);
  assert.match(src, /audits: wait-monitor soft-fail \(exit 4\)/);
  assert.match(src, /Try agent-kit doctor for repository readiness\./);
  const fn = extractSuffix();
  assert.match(fn, /audit_kit_suffix/);
  const result = spawnSync(
    "bash",
    ["-c", `${fn}\nexport CI=1\nprintf '[%s]' "$(audit_kit_suffix 20)"`],
    {
      encoding: "utf8",
    },
  );
  assert.strictEqual(result.status ?? 1, 0, result.stderr);
  assert.strictEqual(result.stdout, "[]");
});

test("audit_kit_suffix is empty under NO_COLOR even without CI", () => {
  const fn = extractSuffix();
  const result = spawnSync(
    "bash",
    ["-c", `${fn}\nunset CI\nexport NO_COLOR=1\nprintf '[%s]' "$(audit_kit_suffix 8)"`],
    { encoding: "utf8" },
  );
  assert.strictEqual(result.status ?? 1, 0, result.stderr);
  assert.strictEqual(result.stdout, "[]");
});
