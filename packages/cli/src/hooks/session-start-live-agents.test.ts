import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LiveRoster, LiveRosterRow } from "../plan-loop/live-roster.js";
import type { QueueLease } from "../plan-loop/queue-lease.js";
import {
  buildSessionStartAdditionalContext,
  formatLiveAgentsSection,
  LIVE_AGENTS_SECTION_MAX_CHARS,
  LIVE_AGENTS_SECTION_MAX_ROWS,
  liveAgentsSection,
} from "./session-start.js";

const ROOT = "/work/repo";

function row(overrides: Partial<LiveRosterRow>): LiveRosterRow {
  return {
    kind: "interactive",
    role: "claude chat",
    pid: 100,
    parentPid: null,
    sessionId: null,
    plan: null,
    todo: null,
    ageSeconds: 60,
    cwd: ROOT,
    worktree: null,
    self: false,
    leaseHolder: false,
    ...overrides,
  };
}

const LEASE: QueueLease = {
  version: 1,
  session: "sess-q",
  host: "h",
  dispatcher: { pid: 200, start: null },
  agent: { pid: 201, start: null },
  startedAt: "2026-11-16T20:00:00Z",
  heartbeatAt: "2026-11-16T20:59:50Z",
};

function roster(overrides: Partial<LiveRoster> = {}): LiveRoster {
  return {
    version: 1,
    root: ROOT,
    generatedAt: "2026-11-16T21:00:00Z",
    lease: { kind: "free" },
    handoff: { plan: null, queueStatus: null },
    rows: [],
    worktrees: [],
    transcripts: [],
    notes: [],
    ...overrides,
  };
}

describe("formatLiveAgentsSection", () => {
  it("prints nothing when alone (own rows, audit rows and a free or stale lease do not count)", () => {
    expect(formatLiveAgentsSection(roster())).toBeNull();
    expect(
      formatLiveAgentsSection(
        roster({
          lease: { kind: "stale", lease: LEASE, reason: "dispatcher pid 200 is gone" },
          rows: [row({ self: true }), row({ kind: "audit", pid: null, role: "audit (tmux)" })],
          worktrees: [{ path: "/wt/mine", branch: "x", pids: [1], self: true }],
        }),
      ),
    ).toBeNull();
  });

  it("names the lease holder first and tells the session not to write", () => {
    const text = formatLiveAgentsSection(
      roster({
        lease: { kind: "held", lease: LEASE, orphan: false, reason: "held by dispatcher pid 200" },
        handoff: { plan: "q.plan.md", queueStatus: "running" },
        rows: [
          row({
            kind: "driver",
            role: "run-plan-all",
            pid: 200,
            leaseHolder: true,
            sessionId: "sess-q",
          }),
          row({ kind: "worker", role: "claude -p", pid: 201, parentPid: 200, leaseHolder: true }),
        ],
        worktrees: [{ path: "/wt/busy", branch: "b", pids: [300], self: false }],
      }),
    ) as string;
    const lines = text.split("\n");
    expect(lines[0]).toBe("## Other live agents in this workspace");
    expect(lines[2]).toContain("Queue lease: HELD by another live session");
    expect(lines[2]).toContain("HANDOFF plan q.plan.md");
    expect(text).toContain("run-plan-all  (lease holder, session sess-q)");
    expect(text).toContain("under pid 200");
    expect(text).toContain("never reuse them): /wt/busy");
    expect(text).toContain("do not write Plan");
  });

  it("lists other agents with a free lease and the check-in rule", () => {
    const text = formatLiveAgentsSection(roster({ rows: [row({ pid: 4242 })] })) as string;
    expect(text).toContain("Queue lease: free.");
    expect(text).toContain("4242");
    expect(text).toContain("Check in with `agent-kit queue lease` before each Ask");
  });

  it("stays inside its row and size budget", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({
        pid: 1000 + i,
        cwd: `/very/long/${"x".repeat(200)}/${i}`,
        sessionId: `s-${"y".repeat(60)}`,
      }),
    );
    const worktrees = Array.from({ length: 10 }, (_, i) => ({
      path: `/wt/${"z".repeat(150)}-${i}`,
      branch: "b",
      pids: [i + 1],
      self: false,
    }));
    const text = formatLiveAgentsSection(roster({ rows, worktrees })) as string;
    expect(text.length).toBeLessThanOrEqual(LIVE_AGENTS_SECTION_MAX_CHARS);
    const shown = text.split("\n").filter((l) => /^ {2}interactive/.test(l));
    expect(shown.length).toBeLessThanOrEqual(LIVE_AGENTS_SECTION_MAX_ROWS);
  });
});

describe("liveAgentsSection", () => {
  it("fails open on a collector error and on the deadline", async () => {
    expect(
      await liveAgentsSection(ROOT, { collect: () => Promise.reject(new Error("boom")) }),
    ).toBeNull();
    const never = new Promise<LiveRoster>(() => {});
    const started = Date.now();
    expect(await liveAgentsSection(ROOT, { collect: () => never, deadlineMs: 50 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("is injected into the session-start context before the HANDOFF excerpt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-session-live-"));
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "HANDOFF.md"),
      "# Handoff\n\n- **Plan:** `p.plan.md`\n",
    );
    const { additional_context } = await buildSessionStartAdditionalContext(
      root,
      {},
      {
        liveRoster: async () => roster({ root, rows: [row({ pid: 777, cwd: root })] }),
      },
    );
    const at = additional_context.indexOf("## Other live agents in this workspace");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(additional_context.indexOf("## Current HANDOFF.md (excerpt)"));
    const alone = await buildSessionStartAdditionalContext(
      root,
      {},
      { liveRoster: async () => roster({ root }) },
    );
    expect(alone.additional_context).not.toContain("Other live agents");
  });
});
