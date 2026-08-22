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

function extractNamed(name) {
  return spawnSync("sed", ["-n", `/^${name}() {/,/^}$/p`, SCRIPT], {
    encoding: "utf8",
  }).stdout;
}

const SESSION_VARS = `
AUDIT_SESSION_NS_PREFIX="agent-kit-audit-"
AUDIT_WS_TOKEN="aaaaaaaa"
AUDIT_SESSION_OWNED_PREFIX="agent-kit-audit-aaaaaaaa-"
AUDIT_SESSION_WARN=5
AUDIT_SESSION_CAP=20
AUDIT_SESSION_HOST_CAP=24
AUDIT_REAP_MIN_AGE=3600
REAP_SESSIONS=0
LAUNCHER_REL=".cursor/scripts/plan-external-review.sh"
`;

test("host scope counts foreign-token and legacy names; owned scope excludes them", () => {
  const fns = [
    "is_owned_audit_session",
    "audit_session_matches_scope",
    "list_audit_sessions",
    "count_audit_sessions",
  ]
    .map(extractNamed)
    .join("\n");
  const bash = `
${SESSION_VARS}
screen() {
  printf 'There are screens on:\\n'
  printf '\\t111.agent-kit-audit-aaaaaaaa-111\\t(Detached)\\n'
  printf '\\t222.agent-kit-audit-bbbbbbbb-222\\t(Detached)\\n'
  printf '\\t333.agent-kit-audit-333\\t(Detached)\\n'
  printf '\\t444.agent-kit-audit-aaaaaaaa-444\\t(Attached)\\n'
  printf '\\t555.other-session\\t(Detached)\\n'
  printf '5 Sockets in /nonexistent-screen-sockdir.\\n'
  return 1
}
tmux() { return 1; }
date() { echo 1000; }
${fns}
printf 'owned=%s host=%s' "$(count_audit_sessions)" "$(count_audit_sessions host)"
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  assert.strictEqual(result.status ?? 1, 0, result.stderr);
  assert.strictEqual(result.stdout, "owned=1 host=3");
});

const MOCK_HOST_PILE = `
list_audit_sessions() {
  printf 'screen\\tagent-kit-audit-aaaaaaaa-1\\tdetached\\t-1\\n'
  printf 'screen\\tagent-kit-audit-bbbbbbbb-2\\tdetached\\t-1\\n'
  printf 'tmux\\tagent-kit-audit-bbbbbbbb-3\\tdetached\\t-1\\n'
  printf 'screen\\tagent-kit-audit-99\\tdetached\\t-1\\n'
  printf 'screen\\tagent-kit-audit-aaaaaaaa-4\\tattached\\t-1\\n'
}
`;

function runPressureGate({ ownedCount, hostCount, hostCap }) {
  const fns = ["audit_session_pressure_gate", "print_host_token_breakdown"]
    .map(extractNamed)
    .join("\n");
  const bash = `
${SESSION_VARS}
AUDIT_SESSION_HOST_CAP=${hostCap}
${MOCK_HOST_PILE}
count_audit_sessions() {
  if [[ "\${1:-owned}" == "host" ]]; then echo ${hostCount}; else echo ${ownedCount}; fi
}
print_dispose_instructions() { echo "DISPOSE_INSTRUCTIONS"; }
emit_paste_only() { echo "PASTE_ONLY:\$1"; }
soft_fail_exit() { echo "SOFT_FAIL"; exit 0; }
${fns}
audit_session_pressure_gate "review"
echo "GATE_PASSED"
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  return { output: result.stdout, exitCode: result.status ?? 1 };
}

test("pressure gate refuses at host cap even when owned count is under the per-token cap", () => {
  const { output, exitCode } = runPressureGate({ ownedCount: 3, hostCount: 12, hostCap: 10 });
  assert.strictEqual(exitCode, 0, output);
  assert.match(output, /REFUSING to spawn - detached audit sessions are at the HOST cap/);
  assert.match(output, /host cap: 10 \(AGENT_KIT_AUDIT_SESSION_HOST_CAP; 0 disables\)/);
  assert.match(output, /DISPOSE_INSTRUCTIONS/);
  assert.match(output, /PASTE_ONLY:review/);
  assert.match(output, /SOFT_FAIL/);
  assert.doesNotMatch(output, /GATE_PASSED/);
});

test("host cap 0 disables the host refusal", () => {
  const { output, exitCode } = runPressureGate({ ownedCount: 3, hostCount: 50, hostCap: 0 });
  assert.strictEqual(exitCode, 0, output);
  assert.doesNotMatch(output, /REFUSING/);
  assert.doesNotMatch(output, /SOFT_FAIL/);
  assert.match(output, /GATE_PASSED/);
});

test("host-cap refusal includes the per-token breakdown with dispose-scope honesty", () => {
  const { output } = runPressureGate({ ownedCount: 1, hostCount: 4, hostCap: 4 });
  assert.match(output, /Per-token breakdown \(detached, namespace-wide\):/);
  assert.match(output, / {2}aaaaaaaa: 1 \(this workspace\)/);
  assert.match(output, / {2}bbbbbbbb: 2/);
  assert.match(output, / {2}unscoped-legacy: 1/);
  assert.match(output, /dispose command below only reaps THIS workspace's share/);
  assert.match(output, /never\ndisposes them/);
});

test("breakdown skips attached sessions and sorts tokens deterministically", () => {
  const fn = extractNamed("print_host_token_breakdown");
  const bash = `
AUDIT_WS_TOKEN="aaaaaaaa"
${MOCK_HOST_PILE}
${fn}
print_host_token_breakdown
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  assert.strictEqual(result.status ?? 1, 0, result.stderr);
  assert.strictEqual(
    result.stdout,
    "  aaaaaaaa: 1 (this workspace)\n  bbbbbbbb: 2\n  unscoped-legacy: 1\n",
  );
});

test("dry-run keeps the parsed owned line and adds the host line", () => {
  const src = spawnSync("cat", [SCRIPT], { encoding: "utf8" }).stdout;
  assert.match(
    src,
    /audit-sessions: \$\{count\} detached owned \(warn: \$\{AUDIT_SESSION_WARN\}, cap: \$\{AUDIT_SESSION_CAP\}\)/,
  );
  assert.match(
    src,
    /audit-sessions-host: \$\{host_count\} detached namespace-wide \(host-cap: \$\{AUDIT_SESSION_HOST_CAP\}\)/,
  );
  assert.match(src, /audit-sessions-gate: would refuse to spawn \(host cap reached\)/);
});

// --- Bounded session lifetime (AGENT_KIT_AUDIT_SESSION_MAX_AGE) ---

const LIFETIME_FNS = ["audit_lifetime_timeout_bin", "audit_bounded_session_cmd"]
  .map(extractNamed)
  .join("\n");

function runBoundedCmd({ maxAge, commandMock, cmd = "echo hi" }) {
  const bash = `
AUDIT_SESSION_MAX_AGE=${maxAge}
${LIFETIME_FNS}
${commandMock}
audit_bounded_session_cmd ${JSON.stringify(cmd)}
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  return { output: result.stdout, exitCode: result.status ?? 1 };
}

test("lifetime wrap prefers timeout when available", () => {
  const { output, exitCode } = runBoundedCmd({
    maxAge: 3600,
    commandMock: `command() { if [[ "\$2" == "timeout" ]]; then return 0; fi; return 1; }`,
  });
  assert.strictEqual(exitCode, 0, output);
  assert.match(output, /^timeout 3600 bash -lc /);
  assert.match(output, /echo\\ hi$/);
});

test("lifetime wrap falls back to gtimeout when timeout is absent", () => {
  const { output, exitCode } = runBoundedCmd({
    maxAge: 900,
    commandMock: `command() { if [[ "\$2" == "gtimeout" ]]; then return 0; fi; return 1; }`,
  });
  assert.strictEqual(exitCode, 0, output);
  assert.match(output, /^gtimeout 900 bash -lc /);
});

test("lifetime wrap falls back to a watchdog subshell scoped to the session's own tree", () => {
  const { output, exitCode } = runBoundedCmd({
    maxAge: 120,
    commandMock: "command() { return 1; }",
  });
  assert.strictEqual(exitCode, 0, output);
  // Literal -$$ must reach the session unexpanded: the watchdog signals only the
  // spawned session's own process group, never attached or foreign-token sessions.
  assert.match(output, /^\( sleep 120; kill -TERM -- -\$\$ /);
  assert.match(output, /\) & echo hi$/);
  assert.doesNotMatch(output, /list_audit_sessions|agent-kit-audit-|pkill/);
});

test("AGENT_KIT_AUDIT_SESSION_MAX_AGE=0 disables the wrap (command byte-identical)", () => {
  const { output, exitCode } = runBoundedCmd({
    maxAge: 0,
    commandMock: "command() { return 0; }",
    cmd: 'echo "h i"',
  });
  assert.strictEqual(exitCode, 0, output);
  assert.strictEqual(output, 'echo "h i"');
});

test("audit_lifetime_timeout_bin returns 1 when neither timeout nor gtimeout exists", () => {
  const fn = extractNamed("audit_lifetime_timeout_bin");
  const bash = `
command() { return 1; }
${fn}
if audit_lifetime_timeout_bin; then echo FOUND; else echo NONE; fi
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  assert.strictEqual(result.status ?? 1, 0, result.stderr);
  assert.match(result.stdout, /NONE/);
  assert.doesNotMatch(result.stdout, /FOUND/);
});

test("max-age env is wired through resolve_int_env with default 3600 and tip fallback", () => {
  const src = spawnSync("cat", [SCRIPT], { encoding: "utf8" }).stdout;
  assert.match(src, /^AUDIT_SESSION_MAX_AGE=3600$/m);
  assert.match(
    src,
    /AUDIT_SESSION_MAX_AGE="\$\(resolve_int_env AGENT_KIT_AUDIT_SESSION_MAX_AGE "\$AUDIT_SESSION_MAX_AGE"\)"/,
  );
  const fn = extractNamed("resolve_int_env");
  const bash = `
export AGENT_KIT_AUDIT_SESSION_MAX_AGE="bogus"
${fn}
resolve_int_env AGENT_KIT_AUDIT_SESSION_MAX_AGE 3600
echo
export AGENT_KIT_AUDIT_SESSION_MAX_AGE=120
resolve_int_env AGENT_KIT_AUDIT_SESSION_MAX_AGE 3600
`;
  const result = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  assert.strictEqual(result.status ?? 1, 0, result.stderr);
  assert.strictEqual(result.stdout, "3600\n120");
  assert.match(
    result.stderr,
    /tip: AGENT_KIT_AUDIT_SESSION_MAX_AGE must be a non-negative integer/,
  );
});

test("spawn site wraps only detached multiplexer sessions; emulator channels stay advisory", () => {
  const src = spawnSync("cat", [SCRIPT], { encoding: "utf8" }).stdout;
  // Self-terminating at spawn: the bounded command is what tmux/screen execute.
  assert.match(src, /tmux new-session -d -s "\$session_name" bash -lc "\$bounded_cmd"/);
  assert.match(src, /screen -dmS "\$session_name" bash -lc "\$bounded_cmd"/);
  // Advisory-only channels keep the unwrapped command (no kill wiring outside the
  // launcher-spawned detached session).
  assert.match(src, /gnome-terminal -- bash -lc "\$shell_cmd; exec bash"/);
  assert.match(src, /bounded_cmd="\$\(audit_bounded_session_cmd "\$shell_cmd"\)"/);
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
