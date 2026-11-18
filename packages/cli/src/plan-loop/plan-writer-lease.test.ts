import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquirePlanWriterLease,
  holdQueueStatus,
  LEASE_FREE_SLASHES,
  nestedUnderLease,
  QUEUE_LEASE_RELPATH,
  type QueueLease,
  type QueueLeaseProc,
  readQueueLease,
} from "./queue-lease.js";

const T0 = Date.parse("2026-11-16T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function lease(over: Partial<QueueLease> = {}): QueueLease {
  return {
    version: 1,
    session: "s-holder",
    host: "box",
    dispatcher: { pid: 1001, start: "11" },
    agent: { pid: 1002, start: "12" },
    startedAt: iso(T0 - 3_600_000),
    heartbeatAt: iso(T0 - 10_000),
    ...over,
  };
}

const aliveSet =
  (...pids: number[]) =>
  (p: QueueLeaseProc) =>
    pids.includes(p.pid);

async function tempRoot(handoff?: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-plan-writer-"));
  if (handoff !== undefined) {
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "HANDOFF.md"), handoff);
  }
  return root;
}

async function writeLease(root: string, l: QueueLease): Promise<void> {
  await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
  await writeFile(path.join(root, QUEUE_LEASE_RELPATH), JSON.stringify(l));
}

/** ppid chain: 3003 -> 3002 -> 1002 (the holder's agent) -> 1001 (dispatcher) -> 1. */
const chain: Record<number, number> = { 3003: 3002, 3002: 1002, 1002: 1001, 1001: 1, 4004: 1 };
const parentOf = (pid: number) => chain[pid] ?? null;

const probe = (extra = {}) => ({
  host: "box",
  now: T0,
  alive: aliveSet(1001, 1002),
  canCheckAncestry: true,
  parentOf,
  ...extra,
});

describe("nestedUnderLease (subsessions, Amend 2026-11-16 point 3)", () => {
  it("joins when the session matches the live lease and the caller descends from its agent", async () => {
    const root = await tempRoot();
    await writeLease(root, lease());
    expect(nestedUnderLease(root, probe({ session: "s-holder", pid: 3003 }))?.session).toBe(
      "s-holder",
    );
  });

  it("an inherited variable without ancestry does not join", async () => {
    const root = await tempRoot();
    await writeLease(root, lease());
    expect(nestedUnderLease(root, probe({ session: "s-holder", pid: 4004 }))).toBeNull();
  });

  it("off Linux (no ancestry check) the session variable alone counts", async () => {
    const root = await tempRoot();
    await writeLease(root, lease());
    expect(
      nestedUnderLease(root, probe({ session: "s-holder", pid: 4004, canCheckAncestry: false })),
    ).not.toBeNull();
  });

  it("another session, no session, no file or a stale lease never join", async () => {
    const root = await tempRoot();
    expect(nestedUnderLease(root, probe({ session: "s-holder", pid: 3003 }))).toBeNull();
    await writeLease(root, lease());
    expect(nestedUnderLease(root, probe({ session: "s-other", pid: 3003 }))).toBeNull();
    expect(nestedUnderLease(root, probe({ session: "", pid: 3003 }))).toBeNull();
    expect(
      nestedUnderLease(root, probe({ session: "s-holder", pid: 3003, alive: aliveSet() })),
    ).toBeNull();
  });
});

describe("acquirePlanWriterLease", () => {
  const handles: Array<{ release: () => void }> = [];
  afterEach(() => {
    for (const h of handles.splice(0)) h.release();
  });
  const env = (alive: (p: QueueLeaseProc) => boolean, extra = {}) => ({
    host: "box",
    pid: 2001,
    now: () => T0,
    alive,
    procStart: (pid: number) => `start-${pid}`,
    heartbeatMs: 3_600_000,
    nested: { session: "", canCheckAncestry: true, parentOf },
    ...extra,
  });

  it("acquires a free workspace lease (same file and schema as run-plan-all)", async () => {
    const root = await tempRoot();
    const got = acquirePlanWriterLease(
      root,
      "agent-kit run-plan",
      env(aliveSet(), { session: "s-new" }),
    );
    expect(got.kind).toBe("acquired");
    if (got.kind !== "acquired") return;
    handles.push(got.handle);
    expect(readQueueLease(root)).toMatchObject({ session: "s-new", dispatcher: { pid: 2001 } });
    got.handle.release();
    expect(existsSync(path.join(root, QUEUE_LEASE_RELPATH))).toBe(false);
  });

  it("refuses while another live writer holds it, naming the command; the file is untouched", async () => {
    const root = await tempRoot();
    await writeLease(root, lease());
    const before = await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8");
    const got = acquirePlanWriterLease(root, "agent-kit run-plan", env(aliveSet(1001, 1002)));
    expect(got.kind).toBe("refused");
    if (got.kind !== "refused") return;
    expect(got.message).toContain(
      "Queue lease held: another live session writes this workspace's plans",
    );
    expect(got.message).toContain("dispatcher pid 1001");
    expect(got.message).toContain("agent-kit run-plan did not start");
    expect(await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8")).toBe(before);
  });

  it("a subsession of the holder runs under its lease: no acquire, no refuse, file untouched", async () => {
    const root = await tempRoot();
    await writeLease(root, lease());
    const before = await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8");
    const got = acquirePlanWriterLease(
      root,
      "agent-kit run-plan",
      env(aliveSet(1001, 1002), {
        nested: { session: "s-holder", pid: 3003, canCheckAncestry: true, parentOf },
      }),
    );
    expect(got).toMatchObject({ kind: "nested", lease: { session: "s-holder" } });
    expect(await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8")).toBe(before);
  });

  it("takes over a stale lease and logs one HANDOFF bullet naming the command", async () => {
    const root = await tempRoot("# Handoff\n- **Older:** kept.\n");
    await writeLease(root, lease());
    const got = acquirePlanWriterLease(
      root,
      "agent-kit run continue-plan",
      env(aliveSet(), { session: "s-new", settleMs: 0 }),
    );
    expect(got.kind).toBe("acquired");
    if (got.kind !== "acquired") return;
    handles.push(got.handle);
    const lines = (await readFile(path.join(root, ".cursor", "HANDOFF.md"), "utf8")).split("\n");
    expect(lines[1]).toContain("(agent-kit run continue-plan, pid 2001, session s-new)");
    expect(lines[1]).toContain("session s-holder");
    expect(lines[2]).toBe("- **Older:** kept.");
  });

  it("read-only slashes are lease-free", () => {
    for (const slash of ["summary", "context-status", "review-pack"]) {
      expect(LEASE_FREE_SLASHES.has(slash)).toBe(true);
    }
    for (const slash of ["continue-plan", "run-plan", "start-project", "backlog-add"]) {
      expect(LEASE_FREE_SLASHES.has(slash)).toBe(false);
    }
  });
});

describe("holdQueueStatus (out-of-queue run, Amend 2026-11-16 point 6)", () => {
  const handoff = (status: string) =>
    `# Handoff\n\n- **Plan:** \`a.plan.md\`\n- **Queue status:** ${status}\n- **Queue cursor:** 2\n`;
  const read = (root: string) => readFile(path.join(root, ".cursor", "HANDOFF.md"), "utf8");
  const by = {
    plan: "b.plan.md",
    who: "agent-kit run-plan session s1",
    at: "2026-11-16T12:00:00Z",
  };

  it("running becomes held and is restored at the end", async () => {
    const root = await tempRoot(handoff("running (pass 22, $1 literal)"));
    const restore = holdQueueStatus(root, by);
    expect(restore).not.toBeNull();
    expect(await read(root)).toContain(
      "- **Queue status:** held (by b.plan.md, agent-kit run-plan session s1, 2026-11-16T12:00:00Z; was running (pass 22, $1 literal))",
    );
    expect(restore?.()).toBe(true);
    expect(await read(root)).toBe(handoff("running (pass 22, $1 literal)"));
  });

  it("paused is held too; other statuses, no queue or no HANDOFF are left alone", async () => {
    const paused = await tempRoot(handoff("paused (operator)"));
    expect(holdQueueStatus(paused, by)).not.toBeNull();
    for (const status of ["stopped", "completed", "held (by x; was running)"]) {
      const root = await tempRoot(handoff(status));
      expect(holdQueueStatus(root, by)).toBeNull();
      expect(await read(root)).toBe(handoff(status));
    }
    expect(holdQueueStatus(await tempRoot("# Handoff\n- **Plan:** `a.plan.md`\n"), by)).toBeNull();
    expect(holdQueueStatus(await tempRoot(), by)).toBeNull();
  });

  it("restore never overwrites a status someone else wrote meanwhile", async () => {
    const root = await tempRoot(handoff("running"));
    const restore = holdQueueStatus(root, by);
    await writeFile(path.join(root, ".cursor", "HANDOFF.md"), handoff("stopped (operator)"));
    expect(restore?.()).toBe(false);
    expect(await read(root)).toBe(handoff("stopped (operator)"));
  });
});
