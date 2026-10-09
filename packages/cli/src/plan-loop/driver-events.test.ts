import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentBackend, claudeBackend, resetClaudeVersionCache } from "./backends.js";
import {
  DRIVER_EVENT_TYPES,
  DRIVER_PROTOCOL_MAJOR,
  DRIVER_PROTOCOL_VERSION,
  DriverAgentSink,
  createDriverAnswerReader,
  createDriverEmitter,
  formatDriverEvent,
  inboundToRawAnswer,
  parseDriverInbound,
} from "./driver-events.js";
import {
  HITL_UNANSWERED_EXIT_CODE,
  type HitlGate,
  askOperator,
  formatHitlGateLine,
} from "./hitl-relay.js";
import { TICK_PROMPT, runPlanLoop } from "./run-loop.js";

type SpawnFn = typeof spawn;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(HERE, "fixtures", "fake-claude.mjs");
const CLI_ENTRY = path.resolve(HERE, "..", "index.ts");
const CLI_PKG = path.resolve(HERE, "..", "..");

const GATE: HitlGate = { askId: "demo", labels: ["Alpha", "Beta"], detection: "sentinel" };

const FIXTURE_PLAN = `---
name: Driver fixture
overview: "Three to-dos; the second one is gated."
todos:
  - id: one
    content: "first"
    status: pending
  - id: two
    content: "second (gate)"
    status: pending
  - id: three
    content: "third"
    status: pending
---

# Driver fixture
`;

type Ev = Record<string, unknown> & { v: number; type: string };

function parseNdjson(text: string): Ev[] {
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Ev);
}

/** Temp kit workspace: the fixture plan plus the claude adapter the backend requires. */
async function fixtureWorkspace(): Promise<{ root: string; plan: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-driver-"));
  await mkdir(path.join(root, ".cursor", "plans"), { recursive: true });
  await mkdir(path.join(root, ".claude", "commands"), { recursive: true });
  const plan = path.join(root, ".cursor", "plans", "driver-fixture.plan.md");
  await writeFile(plan, FIXTURE_PLAN);
  await writeFile(path.join(root, ".claude", "commands", "run-plan.md"), "Run the plan.\n");
  return { root, plan };
}

/** claude backend running the fake claude under node (no PATH lookup, no real binary). */
function fakeClaudeBackend(plan: string): AgentBackend {
  const spawnFn = ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
    spawn(process.execPath, [FAKE_CLAUDE, ...args], opts)) as unknown as SpawnFn;
  return {
    id: "claude",
    resolve: async () => "fake-claude",
    run: (o) =>
      claudeBackend.run({
        ...o,
        spawnFn,
        versionFn: () => "2.1.278 (Claude Code)",
        env: { FAKE_CLAUDE_MODE: "driver-plan", FAKE_CLAUDE_PLAN: plan },
      }),
  };
}

/**
 * Scripted no-TTY client: reads the event stream as it is written and
 * answers each `hitl_gate` through `answer` (null = write nothing).
 */
function scriptedClient(answer: (gate: Ev) => string | null) {
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
      const reply = answer(ev);
      if (reply === null) input.end();
      else input.write(`${reply}\n`);
    }
  };
  return { input, write, gates, events: () => parseNdjson(out) };
}

describe("driver protocol (contract pins)", () => {
  it("pins the protocol version and the event type set", () => {
    expect(DRIVER_PROTOCOL_MAJOR).toBe(1);
    expect(DRIVER_PROTOCOL_VERSION).toBe("1.1.0");
    expect([...DRIVER_EVENT_TYPES]).toEqual([
      "run_start",
      "tick_start",
      "agent_event",
      "agent_text",
      "hitl_gate",
      "tick_end",
      "log",
      "run_end",
    ]);
  });

  it("formats one JSON line per event with v and ts first", () => {
    const line = formatDriverEvent(
      { type: "log", level: "info", message: "hi" },
      () => new Date("2026-10-08T00:00:00.000Z"),
    );
    expect(line.endsWith("\n")).toBe(true);
    expect(line.indexOf("\n")).toBe(line.length - 1);
    expect(line).toBe(
      '{"v":1,"ts":"2026-10-08T00:00:00.000Z","type":"log","level":"info","message":"hi"}\n',
    );
  });

  it("parses inbound replies by number, label or text, and stop", () => {
    expect(parseDriverInbound('{"type":"hitl_reply","askId":"demo","reply":2}')).toEqual({
      ok: true,
      message: { type: "hitl_reply", askId: "demo", reply: 2 },
    });
    expect(
      parseDriverInbound('{"v":1,"type":"hitl_reply","askId":"demo","reply":" Beta "}'),
    ).toEqual({ ok: true, message: { type: "hitl_reply", askId: "demo", reply: "Beta" } });
    expect(parseDriverInbound('{"type":"stop","reason":"user closed the inbox"}')).toEqual({
      ok: true,
      message: { type: "stop", reason: "user closed the inbox" },
    });
  });

  it("rejects anything that is not the contract (never a default answer)", () => {
    const bad = [
      "1",
      "Alpha",
      "[]",
      '{"type":"hitl_reply","askId":"demo"}',
      '{"type":"hitl_reply","askId":"Demo","reply":1}',
      '{"type":"hitl_reply","askId":"demo","reply":0}',
      '{"type":"hitl_reply","askId":"demo","reply":1.5}',
      '{"type":"hitl_reply","askId":"demo","reply":""}',
      '{"type":"hitl_reply","askId":"demo","reply":"a\\nb"}',
      '{"type":"answer","askId":"demo","reply":1}',
      '{"v":2,"type":"hitl_reply","askId":"demo","reply":1}',
    ];
    for (const line of bad) expect(parseDriverInbound(line).ok, line).toBe(false);
  });

  it("maps a reply for another gate to a protocol-error stop", () => {
    expect(
      inboundToRawAnswer(
        GATE,
        parseDriverInbound('{"type":"hitl_reply","askId":"other","reply":1}'),
      ),
    ).toEqual({
      kind: "stop",
      cause: "protocol error",
      detail: "reply for other while gate demo is open",
    });
    expect(inboundToRawAnswer(GATE, parseDriverInbound('{"type":"stop"}'))).toEqual({
      kind: "stop",
      cause: "driver stop",
    });
    expect(
      inboundToRawAnswer(
        GATE,
        parseDriverInbound('{"type":"hitl_reply","askId":"demo","reply":2}'),
      ),
    ).toEqual({ kind: "line", text: "2" });
  });

  it("keeps the HITL_GATE line canonical", () => {
    expect(formatHitlGateLine(GATE)).toBe("HITL_GATE: demo | Alpha | Beta");
  });
});

describe("driver answer reader and askOperator", () => {
  it("emits hitl_gate, then resolves the reply exactly like a typed line (no TTY needed)", async () => {
    const emitted: string[] = [];
    const emitter = createDriverEmitter((t) => emitted.push(t));
    const input = new PassThrough();
    const reader = createDriverAnswerReader({ input, emitter, tick: () => 7 });
    input.write('{"type":"hitl_reply","askId":"demo","reply":"Beta"}\n');
    const outcome = await askOperator(GATE, {
      isTTY: false,
      policy: "driver",
      readAnswer: reader.read,
      write: () => {},
    });
    reader.close();
    expect(outcome.kind).toBe("reply");
    if (outcome.kind !== "reply") return;
    expect(outcome.stamp.line).toBe("HITL_REPLY: demo | operator reply 2 | Beta");
    const gate = parseNdjson(emitted.join(""))[0];
    expect(gate).toMatchObject({
      v: 1,
      type: "hitl_gate",
      tick: 7,
      askId: "demo",
      labels: ["Alpha", "Beta"],
      detection: "sentinel",
      line: "HITL_GATE: demo | Alpha | Beta",
    });
  });

  it("free text is relayed as other; EOF, stop and protocol errors stop with exit 4", async () => {
    const run = async (lines: string[], end: boolean) => {
      const input = new PassThrough();
      const reader = createDriverAnswerReader({
        input,
        emitter: createDriverEmitter(() => {}),
        tick: () => 1,
      });
      for (const l of lines) input.write(`${l}\n`);
      if (end) input.end();
      const outcome = await askOperator(GATE, {
        isTTY: false,
        policy: "driver",
        readAnswer: reader.read,
        write: () => {},
      });
      reader.close();
      return outcome;
    };
    const other = await run(
      ['{"type":"hitl_reply","askId":"demo","reply":"ship it later"}'],
      false,
    );
    expect(other.kind === "reply" && other.stamp.line).toBe(
      "HITL_REPLY: demo | operator reply other | ship it later",
    );
    const eof = await run([], true);
    expect(eof.kind === "stop" && [eof.stop.cause, eof.stop.exitCode]).toEqual([
      "EOF",
      HITL_UNANSWERED_EXIT_CODE,
    ]);
    const stop = await run(['{"type":"stop"}'], false);
    expect(stop.kind === "stop" && stop.stop.message).toBe(
      "stopped-by-operator: gate demo, no reply (driver stop)",
    );
    const bad = await run(["not json"], false);
    expect(bad.kind === "stop" && [bad.stop.cause, bad.stop.message]).toEqual([
      "protocol error",
      "stopped: unanswered gate (driver protocol error: not JSON)",
    ]);
  });

  it("the terminal policy still stops on a non-TTY stdin (driver mode is opt-in)", async () => {
    const readAnswer = vi.fn();
    const outcome = await askOperator(GATE, {
      isTTY: false,
      policy: "prompt",
      readAnswer,
      write: () => {},
    });
    expect(outcome.kind === "stop" && outcome.stop.cause).toBe("no TTY");
    expect(readAnswer).not.toHaveBeenCalled();
  });
});

describe("DriverAgentSink", () => {
  it("wraps each child line in an envelope across chunk boundaries; non-JSON is agent_text", () => {
    const out: string[] = [];
    const sink = new DriverAgentSink(
      createDriverEmitter((t) => out.push(t)),
      3,
    );
    sink.feed('{"type":"result","resu');
    sink.feed('lt":"ok"}\nplain stderr line\n');
    sink.feed(Buffer.from('{"type":"assistant"}'));
    sink.end();
    const events = parseNdjson(out.join(""));
    expect(events.map((e) => e.type)).toEqual(["agent_event", "agent_text", "agent_event"]);
    expect(events[0]).toMatchObject({ tick: 3, event: { type: "result", result: "ok" } });
    expect(events[1]).toMatchObject({ tick: 3, text: "plain stderr line" });
  });
});

describe("run-plan driver mode end to end (fake claude, scripted client, no TTY)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetClaudeVersionCache();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("completes a 3-to-do plan with one gate answered; stdout is NDJSON only", async () => {
    const { root, plan } = await fixtureWorkspace();
    const client = scriptedClient((gate) =>
      JSON.stringify({ type: "hitl_reply", askId: gate.askId, reply: 1 }),
    );
    const stderr: string[] = [];
    const code = await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      backend: fakeClaudeBackend(plan),
      events: { input: client.input, write: client.write, writeErr: (t) => stderr.push(t) },
    });

    expect(code).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
    const events = client.events();
    for (const ev of events) expect(ev.v).toBe(1);
    for (const ev of events) expect(DRIVER_EVENT_TYPES).toContain(ev.type);

    expect(events[0]).toMatchObject({
      type: "run_start",
      protocol: "1.1.0",
      backend: "claude",
      plan: "driver-fixture.plan.md",
      pending: 3,
      hitl: "driver",
    });
    const ticks = events.filter((e) => e.type === "tick_start");
    expect(ticks.map((e) => e.tick)).toEqual([1, 2, 3]);
    expect(ticks[0]?.prompt).toBe(TICK_PROMPT);

    expect(client.gates).toHaveLength(1);
    expect(client.gates[0]).toMatchObject({
      tick: 2,
      askId: "driver-demo",
      labels: ["Proceed", "Hold"],
      line: "HITL_GATE: driver-demo | Proceed | Hold",
    });

    // The child's own replay of the stamp (ADR 2026-09-19 point 4), not a CLI-authored line.
    const stamp = "HITL_REPLY: driver-demo | operator reply 1 | Proceed";
    const replay = events.find(
      (e) =>
        e.type === "agent_event" &&
        (e.event as { type?: string; isReplay?: boolean }).isReplay === true &&
        JSON.stringify(e.event).includes(stamp),
    );
    expect(replay?.tick).toBe(2);
    const gateIdx = events.indexOf(client.gates[0] as Ev);
    expect(events.indexOf(replay as Ev)).toBeGreaterThan(gateIdx);

    const tickEnds = events.filter((e) => e.type === "tick_end");
    expect(tickEnds.map((e) => [e.tick, e.pendingAfter])).toEqual([
      [1, 2],
      [2, 1],
      [3, 0],
    ]);
    expect(tickEnds[0]?.result).toEqual({ kind: "continue", line: "LOOP_TICK_RESULT: continue" });
    expect(tickEnds[2]?.result).toEqual({
      kind: "stop",
      reason: "plan exhausted",
      line: "LOOP_TICK_RESULT: stop - plan exhausted",
    });
    expect(tickEnds[1]?.replies).toEqual([
      expect.objectContaining({
        askId: "driver-demo",
        reply: "operator reply 1",
        label: "Proceed",
        line: stamp,
      }),
    ]);

    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      exitCode: 0,
      ticks: 3,
      pending: 0,
      planExhausted: true,
    });
    expect(await readFile(plan, "utf8")).not.toContain("status: pending");
    expect(stderr.join("")).toContain(`→ ${stamp}`);
  });

  it("EOF at the gate stops the run with exit 4 and no default answer", async () => {
    const { root, plan } = await fixtureWorkspace();
    const client = scriptedClient(() => null);
    const code = await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      backend: fakeClaudeBackend(plan),
      events: { input: client.input, write: client.write, writeErr: () => {} },
    });
    expect(code).toBe(HITL_UNANSWERED_EXIT_CODE);
    const events = client.events();
    const tickEnd = events.filter((e) => e.type === "tick_end").at(-1);
    expect(tickEnd).toMatchObject({
      tick: 2,
      replies: [],
      stop: { askId: "driver-demo", cause: "EOF", exitCode: HITL_UNANSWERED_EXIT_CODE },
    });
    expect(events.at(-1)).toMatchObject({ type: "run_end", exitCode: 4, ticks: 2, pending: 2 });
    expect(JSON.stringify(events)).not.toContain("HITL_REPLY: driver-demo");
  });

  it("a reply for the wrong gate is a protocol error (exit 4), never re-routed", async () => {
    const { root, plan } = await fixtureWorkspace();
    const client = scriptedClient(() =>
      JSON.stringify({ type: "hitl_reply", askId: "some-other-gate", reply: 1 }),
    );
    const code = await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      backend: fakeClaudeBackend(plan),
      events: { input: client.input, write: client.write, writeErr: () => {} },
    });
    expect(code).toBe(HITL_UNANSWERED_EXIT_CODE);
    const stop = client
      .events()
      .filter((e) => e.type === "tick_end")
      .at(-1)?.stop as {
      cause: string;
    };
    expect(stop.cause).toBe("protocol error");
  });

  it("--no-hitl wins in driver mode: the gate stops the run without a hitl_gate read", async () => {
    const { root, plan } = await fixtureWorkspace();
    const client = scriptedClient(() => {
      throw new Error("no gate may be offered under --no-hitl");
    });
    const code = await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      noHitl: true,
      backend: fakeClaudeBackend(plan),
      events: { input: client.input, write: client.write, writeErr: () => {} },
    });
    expect(code).toBe(HITL_UNANSWERED_EXIT_CODE);
    expect(client.gates).toHaveLength(0);
    const events = client.events();
    expect(events[0]).toMatchObject({ type: "run_start", hitl: "off" });
    expect(events.filter((e) => e.type === "tick_end").at(-1)?.stop).toMatchObject({
      cause: "--no-hitl",
    });
  });
});

describe.skipIf(process.platform === "win32")(
  "agent-kit run-plan --events ndjson (CLI subprocess)",
  () => {
    it("a scripted client over pipes drives the real CLI through a 3-to-do plan and one gate", async () => {
      const { root, plan } = await fixtureWorkspace();
      const bin = await mkdtemp(path.join(os.tmpdir(), "agent-kit-driver-bin-"));
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
          "run-plan",
          "--cwd",
          root,
          "--backend",
          "claude",
          "--sleep",
          "0",
          "--events",
          "ndjson",
        ],
        {
          cwd: CLI_PKG,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
            FAKE_CLAUDE_MODE: "driver-plan",
            FAKE_CLAUDE_PLAN: plan,
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
              `${JSON.stringify({ type: "hitl_reply", askId: ev.askId, reply: "Proceed" })}\n`,
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
      expect(events.filter((e) => e.type === "hitl_gate")).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({ type: "run_end", exitCode: 0, pending: 0, ticks: 3 });
      expect(await readFile(plan, "utf8")).not.toContain("status: pending");
    }, 60_000);
  },
);

describe("usage-limit stop and --on-limit (driver mode, fake claude)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetClaudeVersionCache();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  function limitedBackend(): AgentBackend {
    const spawnFn = ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
      spawn(process.execPath, [FAKE_CLAUDE, ...args], opts)) as unknown as SpawnFn;
    return {
      id: "claude",
      resolve: async () => "fake-claude",
      run: (o) =>
        claudeBackend.run({
          ...o,
          spawnFn,
          versionFn: () => "2.1.278 (Claude Code)",
          env: { FAKE_CLAUDE_MODE: "limit" },
        }),
    };
  }

  it("a tick that hits a vendor limit stops the run as usage-limit, plan unchanged", async () => {
    const { root, plan } = await fixtureWorkspace();
    const client = scriptedClient(() => null);
    const code = await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      backend: limitedBackend(),
      events: { input: client.input, write: client.write, writeErr: () => {} },
    });
    expect(code).toBe(0);
    const events = client.events();
    const tickEnd = events.find((e) => e.type === "tick_end");
    expect(tickEnd).toMatchObject({
      tick: 1,
      backend: "claude",
      limit: { source: "rate_limit_event" },
      pendingAfter: 3,
    });
    expect((tickEnd?.limit as { detail: string }).detail).toContain("five_hour rejected");
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      reason: "usage-limit: claude",
      ticks: 1,
      pending: 3,
    });
    expect(await readFile(plan, "utf8")).toBe(FIXTURE_PLAN);
  });

  it("--on-limit continues the same plan on the named backend in the next fresh tick", async () => {
    const { root, plan } = await fixtureWorkspace();
    const client = scriptedClient((gate) =>
      JSON.stringify({ type: "hitl_reply", askId: gate.askId, reply: "Proceed" }),
    );
    const fallback: AgentBackend = { ...fakeClaudeBackend(plan), id: "cursor-agent" };
    const code = await runPlanLoop({
      root,
      maxTicks: 6,
      sleepSeconds: 0,
      dryRun: false,
      backend: limitedBackend(),
      onLimit: fallback,
      events: { input: client.input, write: client.write, writeErr: () => {} },
    });
    expect(code).toBe(0);
    const events = client.events();
    expect(events.filter((e) => e.type === "tick_start").map((e) => e.backend)).toEqual([
      "claude",
      "cursor-agent",
      "cursor-agent",
      "cursor-agent",
    ]);
    expect(events.filter((e) => e.type === "tick_end").map((e) => e.limit === null)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run_end", pending: 0, planExhausted: true });
  });

  it("--on-limit that does not resolve on PATH stops instead of switching", async () => {
    const { root } = await fixtureWorkspace();
    const client = scriptedClient(() => null);
    const missing: AgentBackend = {
      id: "cursor-agent",
      resolve: async () => null,
      run: () => {
        throw new Error("must not run");
      },
    };
    await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      backend: limitedBackend(),
      onLimit: missing,
      events: { input: client.input, write: client.write, writeErr: () => {} },
    });
    const events = client.events();
    expect(events.at(-1)).toMatchObject({ reason: "usage-limit: claude", ticks: 1 });
    expect(JSON.stringify(events)).toContain("--on-limit cursor-agent not found on PATH");
  });
});

describe("runner state root in driver mode", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetClaudeVersionCache();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("AGENT_KIT_STATE_ROOT=.agent-kit moves the tick logs; plans stay in .cursor", async () => {
    vi.stubEnv("AGENT_KIT_STATE_ROOT", ".agent-kit");
    const { root, plan } = await fixtureWorkspace();
    const client = scriptedClient((gate) =>
      JSON.stringify({ type: "hitl_reply", askId: gate.askId, reply: 1 }),
    );
    const code = await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      backend: fakeClaudeBackend(plan),
      events: { input: client.input, write: client.write, writeErr: () => {} },
    });
    expect(code).toBe(0);
    const starts = client.events().filter((e) => e.type === "tick_start");
    expect(starts.length).toBe(3);
    for (const s of starts) expect(String(s.log)).toMatch(/^\.agent-kit[\\/]loop-logs[\\/]tick-/);
    expect(await readFile(path.join(root, ".agent-kit", "loop-logs", ".gitignore"), "utf8")).toBe(
      "*\n",
    );
    expect(await readFile(plan, "utf8")).not.toContain("status: pending");
  });
});
