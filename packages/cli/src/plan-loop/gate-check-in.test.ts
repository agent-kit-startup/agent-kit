import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { askOperator, type HitlGate } from "./hitl-relay.js";
import {
  gateCheckIn,
  QUEUE_LEASE_RELPATH,
  type QueueLease,
  type QueueLeaseProc,
} from "./queue-lease.js";

const T0 = Date.parse("2026-11-16T12:00:00.000Z");

const gate: HitlGate = {
  askId: "risk",
  labels: ["Continue with risk", "Modify approach", "Stop run"],
  detection: "sentinel",
};

function lease(over: Partial<QueueLease> = {}): QueueLease {
  return {
    version: 1,
    session: "s-other",
    host: "box",
    dispatcher: { pid: 1001, start: "11" },
    agent: { pid: 1002, start: "12" },
    startedAt: new Date(T0 - 60_000).toISOString(),
    heartbeatAt: new Date(T0 - 5_000).toISOString(),
    ...over,
  };
}

async function rootWith(l: QueueLease | null): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-gate-checkin-"));
  if (l) {
    await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
    await writeFile(path.join(root, QUEUE_LEASE_RELPATH), JSON.stringify(l));
  }
  return root;
}

const env = (alive: (p: QueueLeaseProc) => boolean) => ({ host: "box", now: () => T0, alive });

describe("askOperator check-in (Amend 2026-11-16 point 4)", () => {
  it("does not offer the gate when the check-in returns a lease line", async () => {
    const readAnswer = vi.fn();
    const write = vi.fn();
    const out = await askOperator(gate, {
      isTTY: true,
      policy: "driver",
      readAnswer,
      write,
      checkIn: () => "Queue lease held: another live session writes this workspace's plans",
    });
    expect(out).toEqual({
      kind: "stop",
      stop: {
        askId: "risk",
        cause: "lease held",
        message:
          "stopped: gate risk not offered (Queue lease held: another live session writes this workspace's plans)",
        exitCode: 4,
      },
    });
    expect(readAnswer).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("asks as before when the check-in is clear", async () => {
    const out = await askOperator(gate, {
      isTTY: true,
      policy: "driver",
      readAnswer: async () => ({ kind: "line", text: "1" }),
      write: () => {},
      checkIn: () => null,
    });
    expect(out.kind).toBe("reply");
  });
});

describe("gateCheckIn", () => {
  it("names a live foreign holder", async () => {
    const root = await rootWith(lease());
    const line = gateCheckIn(
      root,
      () => "s-mine",
      env(() => true),
    )();
    expect(line).toContain("Queue lease held");
    expect(line).toContain("session s-other");
  });

  it("is clear for the caller's own session, a free workspace, a stale lease or an unreadable one", async () => {
    expect(
      gateCheckIn(
        await rootWith(lease()),
        () => "s-other",
        env(() => true),
      )(),
    ).toBeNull();
    expect(
      gateCheckIn(
        await rootWith(null),
        () => null,
        env(() => true),
      )(),
    ).toBeNull();
    expect(
      gateCheckIn(
        await rootWith(lease()),
        () => "s-mine",
        env(() => false),
      )(),
    ).toBeNull();
    const corrupt = await rootWith(null);
    await mkdir(path.join(corrupt, ".cursor", "context"), { recursive: true });
    await writeFile(path.join(corrupt, QUEUE_LEASE_RELPATH), "{not json");
    expect(
      gateCheckIn(
        corrupt,
        () => "s-mine",
        env(() => true),
      )(),
    ).toBeNull();
  });
});
