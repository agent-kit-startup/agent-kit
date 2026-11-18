import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderQueueLease } from "../commands/queue.js";
import {
  acquireQueueLease,
  decideQueueLease,
  forwardTermination,
  inspectQueueLease,
  processAlive,
  procStart,
  QUEUE_LEASE_RELPATH,
  QUEUE_LEASE_TTL_MS,
  type QueueLease,
  type QueueLeaseProc,
  readQueueLease,
} from "./queue-lease.js";

const T0 = Date.parse("2026-11-16T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function lease(over: Partial<QueueLease> = {}): QueueLease {
  return {
    version: 1,
    session: "s-old",
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

const probe = (alive: (p: QueueLeaseProc) => boolean, extra = {}) => ({
  host: "box",
  now: T0,
  alive,
  ...extra,
});

describe("decideQueueLease (pure)", () => {
  it("no file is free", () => {
    expect(decideQueueLease(null, probe(aliveSet()))).toEqual({ kind: "free" });
  });

  it("live owner: dispatcher alive and heartbeat fresh is held (refuse)", () => {
    const v = decideQueueLease(lease({ agent: null }), probe(aliveSet(1001)));
    expect(v).toMatchObject({ kind: "held", orphan: false });
  });

  it("the 2026-11-11 incident: dispatcher gone, agent alive is held as an orphan, naming the agent pid", () => {
    const v = decideQueueLease(lease(), probe(aliveSet(1002)));
    expect(v).toMatchObject({ kind: "held", orphan: true });
    if (v.kind === "held") expect(v.reason).toContain("agent pid 1002");
  });

  it("an expired heartbeat with a live agent still refuses (unresponsive owner)", () => {
    const v = decideQueueLease(
      lease({ heartbeatAt: iso(T0 - QUEUE_LEASE_TTL_MS - 1) }),
      probe(aliveSet(1001, 1002)),
    );
    expect(v).toMatchObject({ kind: "held", orphan: true });
  });

  it("stale takeover: dispatcher and agent both gone", () => {
    const v = decideQueueLease(lease(), probe(aliveSet()));
    expect(v).toMatchObject({ kind: "stale" });
    if (v.kind === "stale") expect(v.reason).toContain("dispatcher pid 1001 is gone");
  });

  it("heartbeat expiry: dispatcher pid alive but no beat for longer than the TTL, no agent", () => {
    const fresh = decideQueueLease(
      lease({ agent: null, heartbeatAt: iso(T0 - QUEUE_LEASE_TTL_MS) }),
      probe(aliveSet(1001)),
    );
    expect(fresh.kind).toBe("held");
    const expired = decideQueueLease(
      lease({ agent: null, heartbeatAt: iso(T0 - QUEUE_LEASE_TTL_MS - 1) }),
      probe(aliveSet(1001)),
    );
    expect(expired).toMatchObject({ kind: "stale" });
    if (expired.kind === "stale") expect(expired.reason).toContain("heartbeat expired");
  });

  it("another host: only the heartbeat counts", () => {
    const other = lease({ host: "other-box" });
    expect(decideQueueLease(other, probe(aliveSet())).kind).toBe("held");
    const old = lease({ host: "other-box", heartbeatAt: iso(T0 - QUEUE_LEASE_TTL_MS - 1) });
    // A pid that happens to be alive here means nothing for another machine.
    expect(decideQueueLease(old, probe(aliveSet(1001, 1002))).kind).toBe("stale");
  });

  it("the caller's own session is own; a corrupt file is stale", () => {
    expect(decideQueueLease(lease(), probe(aliveSet(1001), { session: "s-old" })).kind).toBe("own");
    expect(decideQueueLease("corrupt", probe(aliveSet()))).toMatchObject({ kind: "stale" });
  });
});

async function tempRoot(handoff?: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-queue-lease-"));
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

const env = (alive: (p: QueueLeaseProc) => boolean, extra = {}) => ({
  host: "box",
  pid: 2001,
  now: () => T0,
  alive,
  procStart: (pid: number) => `start-${pid}`,
  heartbeatMs: 3_600_000,
  ...extra,
});

describe("acquireQueueLease (temp folder)", () => {
  const handles: Array<{ release: () => void }> = [];
  afterEach(() => {
    for (const h of handles.splice(0)) h.release();
  });

  it("creates the lease, records the agent, refreshes the heartbeat and removes it on release", async () => {
    const root = await tempRoot();
    let now = T0;
    const got = acquireQueueLease(root, env(aliveSet(), { now: () => now, session: "s-new" }));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    handles.push(got.handle);
    expect(got.handle.takeover).toBeNull();
    const first = readQueueLease(root) as QueueLease;
    expect(first).toMatchObject({
      version: 1,
      session: "s-new",
      host: "box",
      dispatcher: { pid: 2001, start: "start-2001" },
      agent: null,
      startedAt: iso(T0),
    });
    got.handle.setAgent(2002);
    now = T0 + 30_000;
    got.handle.beat();
    const after = readQueueLease(root) as QueueLease;
    expect(after.agent).toEqual({ pid: 2002, start: "start-2002" });
    expect(after.heartbeatAt).toBe(iso(T0 + 30_000));
    expect(after.startedAt).toBe(iso(T0));
    got.handle.release();
    expect(existsSync(path.join(root, QUEUE_LEASE_RELPATH))).toBe(false);
  });

  it("live refuse: a second dispatcher is refused while the owner lives, and the file is untouched", async () => {
    const root = await tempRoot();
    await writeLease(root, lease({ agent: null }));
    const before = await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8");
    const got = acquireQueueLease(root, env(aliveSet(1001)));
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.message).toContain("Queue lease held");
    expect(got.message).toContain("dispatcher pid 1001");
    expect(await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8")).toBe(before);
  });

  it("orphan refuse names the agent pid and how to check it", async () => {
    const root = await tempRoot();
    await writeLease(root, lease());
    const got = acquireQueueLease(root, env(aliveSet(1002)));
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.verdict.orphan).toBe(true);
    expect(got.message).toContain("orphaned agent pid 1002");
    expect(got.message).toContain("ps -o pid,etime,args -p 1002");
  });

  it("stale takeover: replaces the lease and logs one HANDOFF bullet under the title", async () => {
    const root = await tempRoot("# Handoff - title\n- **Older entry:** kept.\n");
    await writeLease(root, lease());
    const got = acquireQueueLease(root, env(aliveSet(), { session: "s-new" }));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    handles.push(got.handle);
    expect(got.handle.takeover?.reason).toContain("dispatcher pid 1001 is gone");
    expect((readQueueLease(root) as QueueLease).session).toBe("s-new");
    const lines = (await readFile(path.join(root, ".cursor", "HANDOFF.md"), "utf8")).split("\n");
    expect(lines[0]).toBe("# Handoff - title");
    expect(lines[1]).toContain("**Queue lease takeover 2026-11-16T12:00:00.000Z");
    expect(lines[1]).toContain("session s-old");
    expect(lines[1]).toContain("agent pid 1002");
    expect(lines[2]).toBe("- **Older entry:** kept.");
  });

  it("heartbeat expiry takeover works without a HANDOFF file (no line written)", async () => {
    const root = await tempRoot();
    await writeLease(
      root,
      lease({ agent: null, heartbeatAt: iso(T0 - QUEUE_LEASE_TTL_MS - 5_000) }),
    );
    const got = acquireQueueLease(root, env(aliveSet(1001)));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    handles.push(got.handle);
    expect(got.handle.takeover?.reason).toContain("heartbeat expired");
    expect(existsSync(path.join(root, ".cursor", "HANDOFF.md"))).toBe(false);
  });

  it("a lost lease stops writing and release leaves the new owner's file alone", async () => {
    const root = await tempRoot();
    const onLost = vi.fn();
    const got = acquireQueueLease(root, env(aliveSet(), { session: "s-mine", onLost }));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const theirs = lease({ session: "s-theirs", heartbeatAt: iso(T0) });
    await writeLease(root, theirs);
    got.handle.beat();
    got.handle.setAgent(4242);
    expect(got.handle.held()).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(readQueueLease(root)).toEqual(theirs);
    got.handle.release();
    expect(readQueueLease(root)).toEqual(theirs);
  });

  it("the heartbeat timer refreshes the file and never keeps the process alive", async () => {
    vi.useFakeTimers();
    try {
      const root = await tempRoot();
      let now = T0;
      const got = acquireQueueLease(
        root,
        env(aliveSet(), { now: () => now, heartbeatMs: 30_000, session: "s-t" }),
      );
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      handles.push(got.handle);
      now = T0 + 30_000;
      vi.advanceTimersByTime(30_000);
      expect((readQueueLease(root) as QueueLease).heartbeatAt).toBe(iso(T0 + 30_000));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("inspectQueueLease and `agent-kit queue lease` output", () => {
  it("read-only: own session is exit 0, another live owner is exit 1, no file is free", async () => {
    const root = await tempRoot();
    expect(renderQueueLease(inspectQueueLease(root), false)).toMatchObject({ exitCode: 0 });
    await writeLease(root, lease({ heartbeatAt: iso(Date.now()) }));
    const before = await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8");
    const held = inspectQueueLease(root, { host: "box", alive: aliveSet(1001) });
    const out = renderQueueLease(held, false);
    expect(out.exitCode).toBe(1);
    expect(out.text).toContain("Queue lease held");
    const own = inspectQueueLease(root, {
      host: "box",
      alive: aliveSet(1001),
      callerSession: "s-old",
    });
    expect(renderQueueLease(own, true)).toMatchObject({ exitCode: 0 });
    expect(JSON.parse(renderQueueLease(own, true).text)).toMatchObject({ kind: "own" });
    expect(await readFile(path.join(root, QUEUE_LEASE_RELPATH), "utf8")).toBe(before);
  });
});

describe("processAlive", () => {
  it("this process is alive with its own start time, not with another one", () => {
    const me = { pid: process.pid, start: procStart(process.pid) };
    expect(processAlive(me)).toBe(true);
    if (process.platform === "linux") {
      expect(processAlive({ pid: process.pid, start: "0" })).toBe(false);
    }
    expect(processAlive({ pid: 0, start: null })).toBe(false);
    expect(processAlive({ pid: 1, start: null })).toBe(false);
  });

  it("an exited child is not alive", () => {
    const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf8",
    });
    expect(processAlive({ pid: Number(child.stdout), start: null })).toBe(false);
  });
});

describe("forwardTermination", () => {
  const agent4242 = { pid: 4242, start: "s" };

  it("SIGTERM and SIGHUP reach the live agent before the exit callback; unregistering removes both", () => {
    const kill = vi.fn();
    const onExit = vi.fn();
    const before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGHUP")];
    const off = forwardTermination(() => agent4242, onExit, { kill, alive: () => true });
    process.emit("SIGTERM", "SIGTERM");
    expect(kill).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(onExit).toHaveBeenCalledWith("SIGTERM");
    process.emit("SIGHUP", "SIGHUP");
    expect(onExit).toHaveBeenLastCalledWith("SIGHUP");
    off();
    expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGHUP")]).toEqual(before);
  });

  it("never signals an agent that already exited (its pid may be reused) or none at all", () => {
    const kill = vi.fn();
    const onExit = vi.fn();
    const offGone = forwardTermination(() => agent4242, onExit, { kill, alive: () => false });
    process.emit("SIGTERM", "SIGTERM");
    offGone();
    const offNone = forwardTermination(() => null, onExit, { kill, alive: () => true });
    process.emit("SIGHUP", "SIGHUP");
    offNone();
    expect(kill).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it("SIGINT is forwarded only when the caller asks for it", () => {
    const kill = vi.fn();
    const onExit = vi.fn();
    const before = process.listenerCount("SIGINT");
    const off = forwardTermination(() => agent4242, onExit, {
      kill,
      alive: () => true,
      signals: ["SIGINT", "SIGTERM", "SIGHUP"],
    });
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    process.emit("SIGINT", "SIGINT");
    off();
    expect(onExit).toHaveBeenCalledWith("SIGINT");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describe("acquire robustness", () => {
  it("an existing file, complete or empty, is never overwritten by the exclusive create", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(path.join(root, QUEUE_LEASE_RELPATH), "");
    // Empty = corrupt = stale: taken over (not silently clobbered by a blind create).
    const got = acquireQueueLease(root, env(aliveSet(), { settleMs: 0, session: "s-a" }));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.handle.takeover?.reason).toBe("unreadable lease file");
    // A second starter now sees a complete, live lease and is refused.
    const second = acquireQueueLease(root, env(aliveSet(2001), { settleMs: 0 }));
    expect(second.ok).toBe(false);
    got.handle.release();
  });

  it("releaseAfterAgent keeps the file while the agent lives and removes it once it is gone", async () => {
    const root = await tempRoot();
    let agentUp = true;
    const alive = (p: QueueLeaseProc) => (p.pid === 2002 ? agentUp : false);
    const got = acquireQueueLease(root, env(alive, { now: () => Date.now(), session: "s-r" }));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    got.handle.setAgent(2002);
    expect(got.handle.agent()).toEqual({ pid: 2002, start: "start-2002" });
    expect(got.handle.releaseAfterAgent(120)).toBe(false);
    expect((readQueueLease(root) as QueueLease).agent?.pid).toBe(2002);
    // The next dispatcher sees the orphan (dispatcher 2001 gone, agent alive).
    const next = acquireQueueLease(root, env(alive, { pid: 3001 }));
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.verdict.orphan).toBe(true);
    agentUp = false;
    expect(got.handle.releaseAfterAgent(120)).toBe(true);
    expect(existsSync(path.join(root, QUEUE_LEASE_RELPATH))).toBe(false);
  });

  it("releaseAfterAgent releases at once when no agent was ever recorded", async () => {
    const root = await tempRoot();
    const got = acquireQueueLease(root, env(aliveSet()));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.handle.releaseAfterAgent(1_000)).toBe(true);
    expect(existsSync(path.join(root, QUEUE_LEASE_RELPATH))).toBe(false);
  });
});
