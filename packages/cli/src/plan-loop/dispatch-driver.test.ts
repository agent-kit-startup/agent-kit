import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRun } from "../commands/run.js";
import { resetClaudeVersionCache } from "./backends.js";
import {
  createQueueStateWatcher,
  DISPATCH_DRIVER_TICK,
  projectQueueState,
  runDispatchDriver,
} from "./dispatch-driver.js";
import { DRIVER_EVENT_TYPES, DRIVER_PROTOCOL_VERSION, type DriverEvent } from "./driver-events.js";
import { HITL_UNANSWERED_EXIT_CODE } from "./hitl-relay.js";

type SpawnFn = typeof spawn;
type Ev = Record<string, unknown> & { v: number; type: string };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(HERE, "fixtures", "fake-claude.mjs");
const CLI_ENTRY = path.resolve(HERE, "..", "index.ts");
const CLI_PKG = path.resolve(HERE, "..", "..");

function parseNdjson(text: string): Ev[] {
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Ev);
}

/** Temp kit workspace with the L0 `/run-plan-all` command file the dispatch reads. */
async function queueWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-queue-driver-"));
  await mkdir(path.join(root, ".cursor", "commands"), { recursive: true });
  await writeFile(
    path.join(root, ".cursor", "commands", "run-plan-all.md"),
    "---\nname: run-plan-all\n---\n\nRun the queue.\n",
  );
  return root;
}

const whichClaude = async (bin: string) => (bin === "claude" ? "/fake/bin/claude" : null);

/** spawn seam: the fake claude under node, in the given scenario. */
function fakeSpawn(mode: string): SpawnFn {
  return ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
    spawn(process.execPath, [FAKE_CLAUDE, ...args], {
      ...opts,
      env: { ...(opts?.env ?? process.env), FAKE_CLAUDE_MODE: mode },
    })) as unknown as SpawnFn;
}

/** Scripted no-TTY client: answers each `hitl_gate` through `answer` (null = close stdin). */
function scriptedClient(answer: (gate: Ev, seen: Ev[]) => string | null) {
  const input = new PassThrough();
  let out = "";
  const gates: Ev[] = [];
  const write = (text: string) => {
    out += text;
    for (const line of text.split("\n")) {
      if (!line) continue;
      const ev = JSON.parse(line) as Ev;
      if (ev.type !== "hitl_gate") continue;
      gates.push(ev);
      const reply = answer(ev, parseNdjson(out));
      if (reply === null) input.end();
      else input.write(`${reply}\n`);
    }
  };
  return { input, write, gates, events: () => parseNdjson(out) };
}

const replyTo = (gate: Ev, reply: number | string = 1) =>
  JSON.stringify({ type: "hitl_reply", askId: gate.askId, reply });

async function runQueue(
  mode: string,
  client: ReturnType<typeof scriptedClient>,
  extra: { dryRun?: boolean; noHitl?: boolean } = {},
) {
  const root = await queueWorkspace();
  const stderr: string[] = [];
  const code = await runDispatchDriver({
    root,
    slash: "run-plan-all",
    backend: "claude",
    dryRun: extra.dryRun === true,
    noHitl: extra.noHitl === true,
    events: { input: client.input, write: client.write, writeErr: (t) => stderr.push(t) },
    whichFn: whichClaude,
    spawnFn: fakeSpawn(mode),
    versionFn: () => "2.1.278 (Claude Code)",
  });
  return { code, root, stderr: stderr.join("") };
}

describe("run-plan-all driver mode (fake claude, scripted client, no TTY)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetClaudeVersionCache();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("answers one gate over stdin; stdout is NDJSON only, one session, no tick events", async () => {
    const client = scriptedClient((gate) => replyTo(gate, 1));
    const { code, stderr } = await runQueue("gate", client);

    expect(code).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
    const events = client.events();
    for (const ev of events) expect(ev.v).toBe(1);
    for (const ev of events) expect(DRIVER_EVENT_TYPES).toContain(ev.type);
    expect(events.some((e) => e.type === "tick_start" || e.type === "tick_end")).toBe(false);

    expect(events[0]).toMatchObject({
      type: "run_start",
      protocol: DRIVER_PROTOCOL_VERSION,
      command: "run-plan-all",
      backend: "claude",
      plan: null,
      pending: null,
      maxTicks: null,
      hitl: "driver",
    });
    expect(client.gates).toEqual([
      expect.objectContaining({
        tick: DISPATCH_DRIVER_TICK,
        askId: "demo",
        labels: ["Alpha", "Beta"],
        line: "HITL_GATE: demo | Alpha | Beta",
      }),
    ]);
    const stamp = "HITL_REPLY: demo | operator reply 1 | Alpha";
    const replay = events.find(
      (e) =>
        e.type === "agent_event" &&
        (e.event as { isReplay?: boolean }).isReplay === true &&
        JSON.stringify(e.event).includes(stamp),
    );
    expect(replay?.tick).toBe(DISPATCH_DRIVER_TICK);
    const gateIdx = events.findIndex((e) => e.type === "hitl_gate");
    expect(gateIdx).toBeGreaterThan(0);
    expect(events.indexOf(replay as Ev)).toBeGreaterThan(gateIdx);
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      exitCode: 0,
      ticks: 1,
      pending: null,
      reason: "session ended",
      planExhausted: false,
      replies: [expect.objectContaining({ askId: "demo", label: "Alpha", line: stamp })],
      stop: null,
    });
    expect(stderr).toContain(`→ ${stamp}`);
  });

  it("answers a gate opened after a background task finished (the #1253 shape)", async () => {
    const client = scriptedClient((gate) => replyTo(gate, "Beta"));
    const { code } = await runQueue("background", client);

    expect(code).toBe(0);
    const events = client.events();
    const firstResult = events.findIndex(
      (e) => e.type === "agent_event" && (e.event as { type?: string }).type === "result",
    );
    const gateIdx = events.findIndex((e) => e.type === "hitl_gate");
    expect(firstResult).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(firstResult);
    expect(client.gates).toHaveLength(1);
    expect(JSON.stringify(events)).toContain("HITL_REPLY: demo | operator reply 2 | Beta");
    expect(events.at(-1)).toMatchObject({ type: "run_end", exitCode: 0, stop: null });
  });

  it("EOF at the gate stops with exit 4 and no default answer", async () => {
    const client = scriptedClient(() => null);
    const { code } = await runQueue("gate", client);

    expect(code).toBe(HITL_UNANSWERED_EXIT_CODE);
    const events = client.events();
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      exitCode: HITL_UNANSWERED_EXIT_CODE,
      replies: [],
      stop: { askId: "demo", cause: "EOF", exitCode: HITL_UNANSWERED_EXIT_CODE },
    });
    expect(JSON.stringify(events)).not.toContain("HITL_REPLY: demo");
  });

  it("a reply for another gate is a protocol error (exit 4), never re-routed", async () => {
    const client = scriptedClient(() =>
      JSON.stringify({ type: "hitl_reply", askId: "queue-confirm", reply: 1 }),
    );
    const { code } = await runQueue("gate", client);

    expect(code).toBe(HITL_UNANSWERED_EXIT_CODE);
    expect(client.events().at(-1)).toMatchObject({
      type: "run_end",
      stop: { askId: "demo", cause: "protocol error" },
    });
  });

  it("--no-hitl wins: run_start says off and the gate stops without a hitl_gate read", async () => {
    const client = scriptedClient((gate) => replyTo(gate));
    const { code } = await runQueue("gate", client, { noHitl: true });

    expect(code).toBe(HITL_UNANSWERED_EXIT_CODE);
    expect(client.gates).toHaveLength(0);
    const events = client.events();
    expect(events[0]).toMatchObject({ type: "run_start", hitl: "off" });
    expect(events.at(-1)).toMatchObject({ type: "run_end", stop: { cause: "--no-hitl" } });
  });

  it("--dry-run emits run_start, the prompt as log events and run_end, and starts nothing", async () => {
    const client = scriptedClient(() => null);
    const { code } = await runQueue("gate", client, { dryRun: true });

    expect(code).toBe(0);
    const events = client.events();
    expect(events.map((e) => e.type)).toEqual([
      "run_start",
      "queue_state",
      "log",
      "log",
      "log",
      "log",
      "run_end",
    ]);
    expect(JSON.stringify(events)).toContain("Run the queue.");
    expect(events.at(-1)).toMatchObject({ exitCode: 0, ticks: 0, reason: "dry-run" });
  });

  it("a setup failure is a log event plus run_end exit 1 (no run_start)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-queue-driver-empty-"));
    const client = scriptedClient(() => null);
    const code = await runDispatchDriver({
      root,
      slash: "run-plan-all",
      backend: "claude",
      dryRun: false,
      events: { input: client.input, write: client.write, writeErr: () => {} },
      whichFn: whichClaude,
    });
    expect(code).toBe(1);
    expect(client.events().map((e) => e.type)).toEqual(["log", "run_end"]);
    expect(client.events()[0]).toMatchObject({ level: "error" });
  });
});

const QUEUE_HANDOFF = `# Handoff

- **Run queue:** [a.plan.md, b.plan.md, c.plan.md]
- **Queue cursor:** 0 (current: a.plan.md)
- **Queue status:** running 2026-10-23 (resume)
`;

describe("queue_state (run-plan-all driver mode)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetClaudeVersionCache();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("projects the HANDOFF queue fields; no queue is all-null with total 0", () => {
    expect(projectQueueState(QUEUE_HANDOFF)).toEqual({
      cursor: 0,
      total: 3,
      current: "a.plan.md",
      status: "running",
    });
    expect(projectQueueState("# Handoff\n\n- **Queue status:** stopped\n")).toEqual({
      cursor: null,
      total: 0,
      current: null,
      status: null,
    });
    expect(
      projectQueueState(
        QUEUE_HANDOFF.replace("running 2026-10-23 (resume)", "held (out-of-queue)"),
      ),
    ).toMatchObject({ status: "held" });
  });

  it("ignores torn HANDOFF reads (blank or half-written) and still flushes the final state", async () => {
    vi.useFakeTimers();
    try {
      const moved = QUEUE_HANDOFF.replace(
        /^- \*\*Queue cursor:\*\*.*$/m,
        "- **Queue cursor:** 1 (current: b.plan.md)",
      );
      const held = moved.replace("running 2026-10-23 (resume)", "held (out-of-queue)");
      // Half-written rewrite: the Run queue line landed, the cursor and status lines did not.
      const partial = moved.slice(0, moved.indexOf("- **Queue cursor:**"));
      expect(projectQueueState(partial)).toMatchObject({ cursor: null, total: 3 });
      let text: string | null = QUEUE_HANDOFF;
      const events: DriverEvent[] = [];
      const watcher = createQueueStateWatcher({
        root: "/unused",
        emitter: { emit: (e) => events.push(e) },
        initial: projectQueueState(QUEUE_HANDOFF),
        pollMs: 10,
        read: async () => text,
      });
      const poll = async (next: string | null) => {
        text = next;
        await vi.advanceTimersByTimeAsync(10);
      };
      // Each torn read sits between two valid ones; none may surface as a queue change.
      await poll("");
      await poll(QUEUE_HANDOFF);
      await poll(partial);
      await poll(QUEUE_HANDOFF);
      await poll("");
      await poll("");
      await poll(partial);
      await poll("");
      await poll(moved); // first sighting of the real change: not yet confirmed
      await poll(""); // truncate mid-rewrite of the same content
      await poll(moved); // confirmed
      await poll(moved);
      // The last write before the session ends is emitted by flush without a confirmation poll.
      text = held;
      await watcher.flush();
      watcher.stop();
      await poll("");
      await poll(null);
      await poll(null);
      expect(events).toEqual([
        { type: "queue_state", cursor: 0, total: 3, current: "a.plan.md", status: "running" },
        { type: "queue_state", cursor: 1, total: 3, current: "b.plan.md", status: "running" },
        { type: "queue_state", cursor: 1, total: 3, current: "b.plan.md", status: "held" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a missing HANDOFF as no queue once two polls agree; flush skips a blank file", async () => {
    vi.useFakeTimers();
    try {
      let text: string | null = QUEUE_HANDOFF;
      const events: DriverEvent[] = [];
      const watcher = createQueueStateWatcher({
        root: "/unused",
        emitter: { emit: (e) => events.push(e) },
        initial: projectQueueState(QUEUE_HANDOFF),
        pollMs: 10,
        read: async () => text,
      });
      text = null;
      await vi.advanceTimersByTimeAsync(10);
      expect(events).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(10);
      expect(events.at(-1)).toEqual({
        type: "queue_state",
        cursor: null,
        total: 0,
        current: null,
        status: null,
      });
      text = "";
      await watcher.flush();
      watcher.stop();
      expect(events).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits the queue at start and on each HANDOFF change, including held; never writes HANDOFF", async () => {
    const root = await queueWorkspace();
    const handoff = path.join(root, ".cursor", "HANDOFF.md");
    await writeFile(handoff, QUEUE_HANDOFF);

    // Answer the gate only once the cursor move made by turn 1 was seen as a queue_state.
    const input = new PassThrough();
    let out = "";
    let gate: Ev | null = null;
    let answered = false;
    const write = (text: string) => {
      out += text;
      for (const line of text.split("\n")) {
        if (!line) continue;
        const ev = JSON.parse(line) as Ev;
        if (ev.type === "hitl_gate") gate = ev;
        const moved = parseNdjson(out).some((e) => e.type === "queue_state" && e.cursor === 1);
        if (gate && moved && !answered) {
          answered = true;
          input.write(`${replyTo(gate, 1)}\n`);
        }
      }
    };
    const code = await runDispatchDriver({
      root,
      slash: "run-plan-all",
      backend: "claude",
      dryRun: false,
      events: { input, write, writeErr: () => {} },
      whichFn: whichClaude,
      spawnFn: ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
        spawn(process.execPath, [FAKE_CLAUDE, ...args], {
          ...opts,
          env: {
            ...(opts?.env ?? process.env),
            FAKE_CLAUDE_MODE: "queue",
            FAKE_CLAUDE_HANDOFF: handoff,
          },
        })) as unknown as SpawnFn,
      versionFn: () => "2.1.278 (Claude Code)",
      queuePollMs: 10,
    });

    expect(code).toBe(0);
    const events = parseNdjson(out);
    const start = { cursor: 0, total: 3, current: "a.plan.md", status: "running" };
    expect(events[0]).toMatchObject({ type: "run_start", queue: start });
    expect(events[1]).toMatchObject({ type: "queue_state", ...start });
    const states = events
      .filter((e) => e.type === "queue_state")
      .map(({ cursor, total, current, status }) => ({ cursor, total, current, status }));
    expect(states).toEqual([
      start,
      { cursor: 1, total: 3, current: "b.plan.md", status: "running" },
      { cursor: 1, total: 3, current: "b.plan.md", status: "held" },
    ]);
    // The last change (written right before the session ended) still precedes run_end.
    expect(events.at(-1)?.type).toBe("run_end");
    // The CLI only reads: HANDOFF is what the agent wrote, nothing more.
    const after = await readFile(handoff, "utf8");
    expect(after).toContain("- **Queue status:** held (out-of-queue");
    expect(after).toContain("- **Queue cursor:** 1 (current: b.plan.md)");
  });
});

describe("executeRun --events routing", () => {
  it("refuses --events for any dispatched slash but run-plan-all", async () => {
    const root = await queueWorkspace();
    const result = await executeRun({
      slash: "backlog-add",
      cwd: root,
      backend: "claude",
      dryRun: true,
      maxTicks: 10,
      sleepSeconds: 5,
      events: {},
      whichFn: whichClaude,
    });
    expect(result).toEqual({
      exitCode: 1,
      error: "--events only applies to run-plan-all (and agent-kit run-plan)",
    });
  });
});

describe.skipIf(process.platform === "win32")(
  "agent-kit run-plan-all --events ndjson (CLI subprocess)",
  () => {
    it("a scripted client over pipes answers a background-task gate through the real CLI", async () => {
      const root = await queueWorkspace();
      const bin = await mkdtemp(path.join(os.tmpdir(), "agent-kit-queue-driver-bin-"));
      const shim = path.join(bin, "claude");
      await writeFile(
        shim,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.278 (Claude Code)"; exit 0; fi\nexec "${process.execPath}" "${FAKE_CLAUDE}" "$@"\n`,
      );
      await chmod(shim, 0o755);

      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          CLI_ENTRY,
          "run-plan-all",
          "--cwd",
          root,
          "--backend",
          "claude",
          "--events",
          "ndjson",
        ],
        {
          cwd: CLI_PKG,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
            FAKE_CLAUDE_MODE: "background",
            NO_COLOR: "1",
          },
        },
      );
      let out = "";
      let pending = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
        const lines = (pending + chunk).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const ev = JSON.parse(line) as Ev;
          if (ev.type === "hitl_gate") {
            child.stdin.write(
              `${JSON.stringify({ type: "hitl_reply", askId: ev.askId, reply: "Alpha" })}\n`,
            );
          }
        }
      });
      let err = "";
      child.stderr.on("data", (c) => {
        err += String(c);
      });
      const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

      expect(err).not.toMatch(/error/i);
      expect(code).toBe(0);
      const events = parseNdjson(out);
      expect(events[0]).toMatchObject({ type: "run_start", command: "run-plan-all" });
      expect(events.filter((e) => e.type === "hitl_gate")).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: "run_end", exitCode: 0, ticks: 1 });
    }, 60_000);
  },
);
