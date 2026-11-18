import { describe, expect, it } from "vitest";
import {
  classifyProcess,
  composeLiveRoster,
  type LiveRosterInput,
  parseEtime,
  parsePs,
  parseWorktreePorcelain,
  readHandoffSummary,
  renderLiveRoster,
} from "./live-roster.js";
import type { QueueLease } from "./queue-lease.js";

const ROOT = "/home/op/agent-kit-dev";
const NOW = Date.parse("2026-11-16T21:00:00Z");
const CLAUDE = "/home/op/.local/share/mise/installs/claude/latest/claude";
const NODE = "/home/op/.local/share/mise/installs/node/latest/bin/node";
const ENGINE = "/home/op/.local/share/colony/engine/6.17.0/dist/index.js";

// Shapes copied from a live `ps -axo pid=,ppid=,etime=,args=` on the operator host.
const PS = [
  `   1696       1  7-08:49:08 /usr/lib/systemd/systemd --user`,
  `  29560    1696  6-07:03:43 claude bg-pty-host --bg-pty-host /tmp/cc-daemon-1000/pty/2b.sock 73 28 -- ${CLAUDE} --session-id 2b35e79e-45d4-4837-8c59-5b1376e85260`,
  `  29576   29560  6-07:03:43 ${CLAUDE} --session-id 2b35e79e-45d4-4837-8c59-5b1376e85260 --permission-mode auto`,
  ` 246283    1696  6-04:38:41 node /opt/agent-kit-cli/dashboard/serve.mjs`,
  `1318079 1864163    06:32:18 ${NODE} ${ENGINE} run-plan-all --events ndjson --backend claude`,
  `1318162 1318079    06:32:18 ${CLAUDE} -p --output-format stream-json --verbose --dangerously-skip-permissions`,
  `1833752    1696    40:00 /home/op/.local/share/colony/app/current/colony`,
  `1990185 1833752    28:10 ${NODE} ${ENGINE} run-plan-all --events ndjson --backend claude`,
  `1990272 1990185    28:10 ${CLAUDE} -p --output-format stream-json --verbose --dangerously-skip-permissions`,
  `2060241 1990272    00:01 /usr/bin/bash -c node agent-kit sessions --live`,
  `2060250 2060241    00:01 ${NODE} /home/op/agent-kit-dev/packages/cli/dist/index.js sessions --live`,
  `1984236 1983879    31:01 /home/op/.local/share/mise/installs/claude/2.1.325/claude --chrome-native-host`,
  `3039778    1696 1-10:15:29 ${CLAUDE} daemon run --origin transient`,
  `3855656 1836987 1-00:15:52 ${CLAUDE}`,
  `4006517 1864163  22:16:17 ${CLAUDE}`,
  `4100000    1696    05:00 agent-kit run-plan --plan agent-session-checkin.plan.md --max-ticks 3`,
  `4100100    1696    02:00 pnpm vitest run`,
].join("\n");

const CWD: Record<number, string> = {
  29576: "/home/op/code/other-a",
  1318079: "/home/op/code/other-b",
  1318162: "/home/op/code/other-b",
  1990185: ROOT,
  1990272: ROOT,
  2060241: ROOT,
  2060250: ROOT,
  3855656: "/home/op/code/other-c",
  4006517: `${ROOT}/vendor/other-repo`,
  4100000: "/home/op/wt/checkin-k1/packages/cli",
  4100100: "/home/op/wt/checkin-k1",
};

const PORCELAIN = [
  `worktree ${ROOT}`,
  "HEAD ef71b44c",
  "branch refs/heads/staging",
  "",
  "worktree /home/op/wt/checkin-k1",
  "HEAD 69360632",
  "branch refs/heads/feat/agent-session-checkin-k1",
  "",
  "worktree /home/op/wt/idle",
  "HEAD 22367f37",
  "detached",
  "",
].join("\n");

function lease(overrides: Partial<QueueLease> = {}): QueueLease {
  return {
    version: 1,
    session: "sess-1",
    host: "kvm",
    dispatcher: { pid: 1990185, start: "1" },
    agent: { pid: 1990272, start: "2" },
    startedAt: "2026-11-16T20:30:00Z",
    heartbeatAt: "2026-11-16T20:59:50Z",
    ...overrides,
  };
}

function input(overrides: Partial<LiveRosterInput> = {}): LiveRosterInput {
  return {
    root: ROOT,
    now: NOW,
    ps: PS,
    cwdOf: (pid) => CWD[pid] ?? null,
    allPids: Object.keys(CWD).map(Number),
    selfPid: 9_999_999,
    worktreePorcelain: PORCELAIN,
    lease: { kind: "free" },
    handoffText: null,
    transcripts: [],
    audit: [],
    isNestedRepo: (dir) => dir === `${ROOT}/vendor/other-repo`,
    ...overrides,
  };
}

describe("parseEtime / parsePs", () => {
  it("reads the ps etime forms", () => {
    expect(parseEtime("00:52")).toBe(52);
    expect(parseEtime("06:32:18")).toBe(6 * 3600 + 32 * 60 + 18);
    expect(parseEtime("1-10:15:29")).toBe(86_400 + 10 * 3600 + 15 * 60 + 29);
    expect(parseEtime("bogus")).toBeNull();
  });

  it("parses pid, ppid, age and argv", () => {
    const rows = parsePs(PS);
    const engine = rows.find((r) => r.pid === 1990185);
    expect(engine?.ppid).toBe(1833752);
    expect(engine?.ageSeconds).toBe(28 * 60 + 10);
    expect(engine?.argv.slice(2, 4)).toEqual(["run-plan-all", "--events"]);
  });
});

describe("classifyProcess", () => {
  const argv = (line: string) => parsePs(line)[0]?.argv ?? [];
  it("skips Claude helpers, dashboards, colony itself and the roster command", () => {
    for (const pid of [29560, 246283, 1833752, 1984236, 3039778, 2060241, 2060250, 4100100]) {
      const line = PS.split("\n").find((l) => l.trim().startsWith(`${pid} `)) as string;
      expect(classifyProcess(argv(line)), String(pid)).toBeNull();
    }
  });

  it("names claude chats, headless claude and the Colony engine", () => {
    expect(classifyProcess([CLAUDE])).toMatchObject({ kind: "interactive", role: "claude chat" });
    expect(classifyProcess([CLAUDE, "-p", "--verbose"])).toMatchObject({
      kind: "headless",
      role: "claude -p",
    });
    expect(
      classifyProcess([CLAUDE, "--session-id", "2b35e79e-45d4-4837-8c59-5b1376e85260"])?.sessionId,
    ).toBe("2b35e79e-45d4-4837-8c59-5b1376e85260");
    expect(classifyProcess([NODE, ENGINE, "run-plan-all", "--events", "ndjson"])).toMatchObject({
      agent: "agent-kit",
      kind: "driver",
      role: "run-plan-all",
    });
  });

  it("reads plan and to-do flags and the run slash", () => {
    expect(
      classifyProcess(["agent-kit", "run-plan", "--plan=a.plan.md", "--todo", "k1"]),
    ).toMatchObject({ kind: "headless", role: "run-plan", plan: "a.plan.md", todo: "k1" });
    expect(classifyProcess(["agent-kit", "run", "continue-plan"])?.role).toBe("run continue-plan");
    expect(classifyProcess(["agent-kit", "countdown", "--job", "review"])?.role).toBe("countdown");
    expect(classifyProcess(["agent-kit", "hook", "session-start"])).toBeNull();
    expect(classifyProcess(["cursor-agent", "-p", "go"])?.role).toBe("cursor-agent -p");
  });
});

describe("composeLiveRoster", () => {
  it("scopes by working directory: other repos and nested repos are out", () => {
    const r = composeLiveRoster(input());
    const pids = r.rows.map((row) => row.pid);
    expect(pids).toContain(1990185);
    expect(pids).toContain(1990272);
    expect(pids).toContain(4100000);
    // other repo engine and chats, nested repo chat
    for (const out of [1318079, 1318162, 29576, 3855656, 4006517]) expect(pids).not.toContain(out);
  });

  it("nests agents under their agent parent and marks the caller's own chain", () => {
    const r = composeLiveRoster(input({ selfPid: 2060250 }));
    const driver = r.rows.find((row) => row.pid === 1990185);
    const worker = r.rows.find((row) => row.pid === 1990272);
    expect(driver).toMatchObject({ kind: "driver", self: true, parentPid: null });
    expect(worker).toMatchObject({ kind: "worker", parentPid: 1990185, self: true });
    const headless = r.rows.find((row) => row.pid === 4100000);
    expect(headless).toMatchObject({
      kind: "headless",
      self: false,
      plan: "agent-session-checkin.plan.md",
      worktree: "/home/op/wt/checkin-k1",
    });
  });

  it("puts the live lease holder first with its session and the HANDOFF plan", () => {
    const r = composeLiveRoster(
      input({
        lease: {
          kind: "held",
          lease: lease(),
          orphan: false,
          reason: "held by dispatcher pid 1990185",
        },
        handoffText:
          "# H\n- **Plan:** `agent-session-checkin-2026-11-16.plan.md`\n- **Queue status:** running (pass 22)\n",
      }),
    );
    expect(r.rows[0]).toMatchObject({ pid: 1990185, leaseHolder: true, sessionId: "sess-1" });
    expect(r.rows[1]).toMatchObject({ pid: 1990272, leaseHolder: true });
    expect(r.handoff).toEqual({
      plan: "agent-session-checkin-2026-11-16.plan.md",
      queueStatus: "running",
    });
    const text = renderLiveRoster(r);
    expect(text).toContain("Queue lease: HELD by another live session");
    expect(text).toContain("HANDOFF plan agent-session-checkin-2026-11-16.plan.md");
  });

  it("adds a lease row when the holder is not in the process scan (other host)", () => {
    const r = composeLiveRoster(
      input({
        ps: "",
        lease: {
          kind: "held",
          lease: lease({ host: "laptop", dispatcher: { pid: 42, start: null }, agent: null }),
          orphan: false,
          reason: "held by host laptop (fresh heartbeat)",
        },
      }),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      pid: 42,
      role: "lease holder (host laptop)",
      leaseHolder: true,
    });
  });

  it("marks lease rows as self when the caller owns the lease session", () => {
    const r = composeLiveRoster(input({ lease: { kind: "own", lease: lease() } }));
    expect(r.rows.filter((row) => row.leaseHolder).every((row) => row.self)).toBe(true);
  });

  it("lists worktrees with any live process, never the root or idle ones", () => {
    const r = composeLiveRoster(input({ selfPid: 4100100 }));
    expect(r.worktrees).toEqual([
      {
        path: "/home/op/wt/checkin-k1",
        branch: "feat/agent-session-checkin-k1",
        pids: [4100000, 4100100],
        self: true,
      },
    ]);
  });

  it("keeps recent transcripts only, as hints", () => {
    const r = composeLiveRoster(
      input({
        transcripts: [
          { id: "aaaaaaaa-0000-4000-8000-000000000000", modifiedMs: NOW - 60_000 },
          { id: "bbbbbbbb-0000-4000-8000-000000000000", modifiedMs: NOW - 3 * 3_600_000 },
        ],
      }),
    );
    expect(r.transcripts).toEqual([
      {
        id: "aaaaaaaa-0000-4000-8000-000000000000",
        modified: new Date(NOW - 60_000).toISOString(),
        ageSeconds: 60,
      },
    ]);
  });

  it("adds audit sessions as rows", () => {
    const r = composeLiveRoster(
      input({ ps: "", audit: [{ channel: "tmux", name: "agent-kit-audit-x-1", ageSeconds: 120 }] }),
    );
    expect(r.rows).toEqual([
      expect.objectContaining({ kind: "audit", sessionId: "agent-kit-audit-x-1", ageSeconds: 120 }),
    ]);
  });

  it("fails open: missing sources become notes, and without /proc the command line scopes", () => {
    const r = composeLiveRoster(
      input({
        ps: `  77  1  01:00 agent-kit run-plan --cwd=${ROOT}\n  78  1  01:00 ${CLAUDE} -p`,
        cwdOf: () => null,
        allPids: null,
        worktreePorcelain: null,
        transcripts: null,
        audit: null,
      }),
    );
    expect(r.rows.map((row) => row.pid)).toEqual([77]);
    expect(r.worktrees).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/no \/proc/);
    expect(r.notes.join(" ")).toMatch(/git worktree list unavailable/);
    expect(r.notes.join(" ")).toMatch(/tmux\/screen/);
    const none = composeLiveRoster(input({ ps: null }));
    expect(none.rows).toEqual([]);
    expect(none.notes).toContain("ps unavailable: no process rows");
  });

  it("never carries raw command lines", () => {
    const r = composeLiveRoster(input());
    expect(JSON.stringify(r)).not.toContain("--dangerously-skip-permissions");
  });
});

describe("helpers", () => {
  it("parses porcelain worktrees", () => {
    expect(parseWorktreePorcelain(PORCELAIN).map((w) => w.branch)).toEqual([
      "staging",
      "feat/agent-session-checkin-k1",
      "(detached)",
    ]);
  });

  it("reads HANDOFF plan and queue status, tolerating absence", () => {
    expect(readHandoffSummary(null)).toEqual({ plan: null, queueStatus: null });
    expect(readHandoffSummary("- **Queue status:** paused (operator)")).toEqual({
      plan: null,
      queueStatus: "paused",
    });
  });
});
