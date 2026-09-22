import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HitlRunOptions,
  claudeBackend,
  cursorAgentBackend,
  resetClaudeVersionCache,
} from "./backends.js";
import {
  FALLBACK_ASK_ID,
  HITL_SIGINT_EXIT_CODE,
  HITL_UNANSWERED_EXIT_CODE,
  type RawAnswer,
  TurnWatcher,
  createTerminalAnswerReader,
  detectFallbackGate,
  detectHitlGate,
  formatGatePrompt,
  formatHitlReply,
  formatHitlSummary,
  hitlExitCode,
  parseHitlGateLine,
  resolveOperatorAnswer,
  userEventLine,
} from "./hitl-relay.js";

type SpawnFn = typeof spawn;

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_CLAUDE = path.join(FIXTURES, "fake-claude.mjs");
const FAKE_CURSOR = path.join(FIXTURES, "fake-cursor-agent.mjs");
const QUEUE_DRIFT_LOG = path.join(FIXTURES, "claude-stream-run-plan-all-queue-drift.log");

/** Runs the fake agent script under node in place of the real binary; argv and options pass through. */
function fakeSpawn(script: string): SpawnFn {
  return ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
    spawn(process.execPath, [script, ...args], opts)) as unknown as SpawnFn;
}

/** Scripted operator: one raw answer per gate, in order. */
function scriptedReader(answers: RawAnswer[]) {
  const seen: string[] = [];
  const reader: NonNullable<HitlRunOptions["readAnswer"]> = async (gate) => {
    seen.push(gate.askId);
    const next = answers.shift();
    if (!next) throw new Error("no scripted answer left");
    return next;
  };
  return { reader, seen };
}

const line = (text: string): RawAnswer => ({ kind: "line", text });
const versionOk = () => "2.1.278 (Claude Code)";

async function tmpLog(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-hitl-"));
  return path.join(dir, "run.log");
}

async function lastResultText(): Promise<string> {
  const content = await readFile(QUEUE_DRIFT_LOG, "utf8");
  let last = "";
  for (const raw of content.split("\n")) {
    if (!raw.startsWith("{")) continue;
    try {
      const ev = JSON.parse(raw) as { type?: string; result?: unknown };
      if (ev.type === "result" && typeof ev.result === "string") last = ev.result;
    } catch {
      // not JSON
    }
  }
  return last;
}

describe("HITL_GATE sentinel parsing", () => {
  it("parses ask-id and labels, trims, and rejects malformed lines", () => {
    expect(
      parseHitlGateLine("HITL_GATE: queue-drift | Resume frozen queue | Insert new backlog"),
    ).toEqual({
      askId: "queue-drift",
      labels: ["Resume frozen queue", "Insert new backlog"],
      detection: "sentinel",
    });
    expect(parseHitlGateLine("  HITL_GATE:gate-a|A|B  ")).toEqual({
      askId: "gate-a",
      labels: ["A", "B"],
      detection: "sentinel",
    });
    expect(parseHitlGateLine("HITL_GATE: Bad Id | A")).toBeNull();
    expect(parseHitlGateLine("HITL_GATE: demo")).toBeNull();
    expect(parseHitlGateLine("HITL_GATE: demo |")).toBeNull();
    expect(parseHitlGateLine("see HITL_GATE: demo | A | B")).toBeNull();
  });

  it("prefers the result text, then the turn's assistant blocks, and never a tick result", () => {
    const gateText = "x\nHITL_GATE: demo | A | B\n1. A\n2. B";
    expect(detectHitlGate(gateText, [])?.askId).toBe("demo");
    expect(detectHitlGate("plain", ["early", gateText])?.askId).toBe("demo");
    expect(detectHitlGate("plain", [])).toBeNull();
    expect(detectHitlGate(`${gateText}\nLOOP_TICK_RESULT: continue`, [])).toBeNull();
    expect(detectHitlGate("done\nLOOP_TICK_RESULT: stop - gate", [gateText])).toBeNull();
    expect(detectHitlGate("HITL_GATE: first | A | B\nHITL_GATE: last | C | D", [])?.askId).toBe(
      "last",
    );
  });
});

describe("prose fallback detection", () => {
  it("needs a numbered list of two or more plus an Ask sentence", () => {
    expect(
      detectFallbackGate(
        "Ask questions is not available in this session. Reply with the number or the label.\n\n1. Alpha\n2. Beta\n",
      ),
    ).toEqual({ askId: FALLBACK_ASK_ID, labels: ["Alpha", "Beta"], detection: "fallback" });
    expect(detectFallbackGate("Reply with the number or the label.\n1. Only one\n")).toBeNull();
    expect(detectFallbackGate("Steps:\n1. Alpha\n2. Beta\n")).toBeNull();
  });

  it("detects the recorded queue-drift gate of the Phase 1 fixture (a real pre-sentinel Ask)", async () => {
    const text = await lastResultText();
    expect(text).toContain("Queue drift");
    const gate = detectHitlGate(text, []);
    expect(gate).toEqual({
      askId: FALLBACK_ASK_ID,
      labels: ["Resume frozen queue", "Insert new backlog", "Re-synthesize"],
      detection: "fallback",
    });
  });
});

describe("operator answer resolution and stamps", () => {
  const labels = ["Resume frozen queue", "Insert new backlog", "Cancel"];

  it("accepts a number or an exact label; anything else is other; empty/skip/cancel stop", () => {
    expect(resolveOperatorAnswer("2", labels)).toEqual({
      kind: "reply",
      n: 2,
      label: "Insert new backlog",
    });
    expect(resolveOperatorAnswer(" Resume frozen queue ", labels)).toEqual({
      kind: "reply",
      n: 1,
      label: "Resume frozen queue",
    });
    expect(resolveOperatorAnswer("0", labels)).toEqual({ kind: "other", text: "0" });
    expect(resolveOperatorAnswer("9", labels)).toEqual({ kind: "other", text: "9" });
    expect(resolveOperatorAnswer("use slot 3", labels)).toEqual({
      kind: "other",
      text: "use slot 3",
    });
    expect(resolveOperatorAnswer("", labels)).toEqual({ kind: "stop", cause: "empty" });
    expect(resolveOperatorAnswer("skip", labels)).toEqual({ kind: "stop", cause: "skip" });
    expect(resolveOperatorAnswer("cancel", ["A", "B"])).toEqual({ kind: "stop", cause: "cancel" });
    // A listed `Cancel` label is relayed as that label; the agent stops under its own contract.
    expect(resolveOperatorAnswer("Cancel", labels)).toEqual({
      kind: "reply",
      n: 3,
      label: "Cancel",
    });
  });

  it("formats the reply stamp, the prompt, the user event and the summary", () => {
    expect(
      formatHitlReply("queue-drift", { kind: "reply", n: 1, label: "Resume frozen queue" }),
    ).toBe("HITL_REPLY: queue-drift | operator reply 1 | Resume frozen queue");
    expect(formatHitlReply("queue-drift", { kind: "other", text: "slot 3" })).toBe(
      "HITL_REPLY: queue-drift | operator reply other | slot 3",
    );
    expect(() => formatHitlReply("x", { kind: "stop", cause: "empty" })).toThrow();
    expect(formatGatePrompt({ askId: "demo", labels: ["A", "B"], detection: "sentinel" })).toBe(
      '\nHITL gate demo: reply with the number or the label; anything else is sent as "other"; empty, skip, cancel or Ctrl-C stops the run.\n  1. A\n  2. B\n',
    );
    expect(userEventLine("hi")).toBe('{"type":"user","message":{"role":"user","content":"hi"}}\n');
    expect(
      formatHitlSummary({
        replies: [
          {
            askId: "demo",
            reply: "operator reply 1",
            label: "A",
            line: "HITL_REPLY: demo | operator reply 1 | A",
            at: "2026-09-19T00:00:00.000Z",
            detection: "sentinel",
          },
        ],
        fallbackDetections: 1,
        stop: {
          askId: "x",
          cause: "EOF",
          message: "stopped-by-operator: gate x, no reply (EOF)",
          exitCode: 4,
        },
      }),
    ).toEqual([
      "HITL demo: operator reply 1 (A) 2026-09-19T00:00:00.000Z",
      "hitl-detect: prose-fallback x1",
      "stopped-by-operator: gate x, no reply (EOF)",
    ]);
    expect(formatHitlSummary(undefined)).toEqual([]);
    expect(hitlExitCode(0, undefined)).toBe(0);
    expect(hitlExitCode(0, { replies: [], fallbackDetections: 0 })).toBe(0);
    expect(
      hitlExitCode(0, {
        replies: [],
        fallbackDetections: 0,
        stop: { askId: "x", cause: "SIGINT", message: "m", exitCode: HITL_SIGINT_EXIT_CODE },
      }),
    ).toBe(130);
  });
});

describe("TurnWatcher", () => {
  it("collects assistant text per turn and fires on each result, across chunk boundaries", () => {
    const seen: { resultText: string; assistantTexts: string[] }[] = [];
    const watcher = new TurnWatcher((info) => seen.push(info));
    const a1 = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "one" }] },
    });
    const r1 = JSON.stringify({ type: "result", result: "r1" });
    const a2 = JSON.stringify({ type: "assistant", message: { content: "two" } });
    const r2 = JSON.stringify({ type: "result", result: "r2" });
    const stream = `${a1}\n${r1}\nnot json\n${a2}\n${r2}\n`;
    const half = Math.floor(stream.length / 2);
    watcher.feed(Buffer.from(stream.slice(0, half)));
    watcher.feed(Buffer.from(stream.slice(half)));
    watcher.end();
    expect(seen).toEqual([
      { resultText: "r1", assistantTexts: ["one"], isError: false, subtype: null },
      { resultText: "r2", assistantTexts: ["two"], isError: false, subtype: null },
    ]);
  });
});

describe("terminal answer reader", () => {
  it("returns one line, EOF on stream end, and EOF on abort", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const reader = createTerminalAnswerReader({ input, output, terminal: false });
    const gate = { askId: "demo", labels: ["A"], detection: "sentinel" as const };
    const pending = reader(gate, {});
    input.write("2\n");
    expect(await pending).toEqual({ kind: "line", text: "2" });

    const input2 = new PassThrough();
    const reader2 = createTerminalAnswerReader({ input: input2, output, terminal: false });
    const pending2 = reader2(gate, {});
    input2.end();
    expect(await pending2).toEqual({ kind: "eof" });

    const input3 = new PassThrough();
    const reader3 = createTerminalAnswerReader({ input: input3, output, terminal: false });
    const abort = new AbortController();
    const pending3 = reader3(gate, { signal: abort.signal });
    abort.abort();
    expect(await pending3).toEqual({ kind: "eof" });
  });

  it("in terminal (raw) mode Ctrl-C is the readline SIGINT keypress, and a typed line still resolves", async () => {
    const gate = { askId: "demo", labels: ["A"], detection: "sentinel" as const };
    const output = new PassThrough();
    output.resume();

    const input = new PassThrough();
    const reader = createTerminalAnswerReader({ input, output, terminal: true });
    const pending = reader(gate, {});
    input.write("\x03");
    expect(await pending).toEqual({ kind: "sigint" });

    const input2 = new PassThrough();
    const reader2 = createTerminalAnswerReader({ input: input2, output, terminal: true });
    const pending2 = reader2(gate, {});
    input2.write("A\r");
    expect(await pending2).toEqual({ kind: "line", text: "A" });
  });
});

describe("claude relay with the fake claude (stream-json stdin transport)", () => {
  let echoed: string[];
  const run = async (opts: {
    mode?: string;
    answers?: RawAnswer[];
    policy?: "prompt" | "off";
    isTTY?: boolean;
    killAfterMs?: number;
  }) => {
    const logPath = await tmpLog();
    const scripted = scriptedReader(opts.answers ?? []);
    const result = await claudeBackend.run({
      workspace: os.tmpdir(),
      prompt: "Pick one option, please.",
      logPath,
      env: { FAKE_CLAUDE_MODE: opts.mode ?? "gate" },
      spawnFn: fakeSpawn(FAKE_CLAUDE),
      versionFn: versionOk,
      log: () => {},
      hitl: {
        policy: opts.policy ?? "prompt",
        isTTY: opts.isTTY ?? true,
        readAnswer: scripted.reader,
        write: (text) => echoed.push(text),
        killAfterMs: opts.killAfterMs,
      },
    });
    const log = await readFile(logPath, "utf8");
    return { result, log, asked: scripted.seen, terminal: echoed.join("") };
  };

  beforeEach(() => {
    resetClaudeVersionCache();
    echoed = [];
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      echoed.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetClaudeVersionCache();
  });

  it("answers a sentinel gate by number: stamp relayed, echoed by the child into the log, session continues", async () => {
    const { result, log, asked, terminal } = await run({ answers: [line("1")] });
    expect(asked).toEqual(["demo"]);
    expect(result.exitCode).toBe(0);
    expect(result.hitl?.stop).toBeUndefined();
    expect(result.hitl?.replies).toHaveLength(1);
    const stamp = result.hitl?.replies[0];
    expect(stamp?.line).toBe("HITL_REPLY: demo | operator reply 1 | Alpha");
    expect(stamp?.detection).toBe("sentinel");
    // The child's replay of the reply is what lands in the log (isReplay: true), byte for byte.
    const replayed = log
      .split("\n")
      .filter((l) => l.includes('"isReplay":true'))
      .map((l) => JSON.parse(l) as { message: { content: string } });
    expect(replayed.map((e) => e.message.content)).toEqual([
      "Pick one option, please.",
      "HITL_REPLY: demo | operator reply 1 | Alpha",
    ]);
    // The second turn ran in the same session and received the stamp.
    expect(log).toContain("received: HITL_REPLY: demo | operator reply 1 | Alpha");
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(0);
    // Terminal: the gate prompt, the outgoing stamp, the child's echo, no raw NDJSON.
    expect(terminal).toContain("HITL gate demo:");
    expect(terminal).toContain("  1. Alpha\n  2. Beta\n");
    expect(terminal).toContain("→ HITL_REPLY: demo | operator reply 1 | Alpha\n");
    expect(terminal).toContain("↩ HITL_REPLY: demo | operator reply 1 | Alpha\n");
    expect(terminal).toContain("· prompt sent · 24 chars\n");
    expect(terminal).not.toContain('{"type":');
  });

  it("answers by exact label and relays a free-text answer as other", async () => {
    const byLabel = await run({ answers: [line("Beta")] });
    expect(byLabel.result.hitl?.replies[0]?.line).toBe(
      "HITL_REPLY: demo | operator reply 2 | Beta",
    );
    expect(byLabel.log).toContain("received: HITL_REPLY: demo | operator reply 2 | Beta");

    const other = await run({ answers: [line("neither, use slot 3")] });
    expect(other.result.hitl?.replies[0]?.line).toBe(
      "HITL_REPLY: demo | operator reply other | neither, use slot 3",
    );
    expect(other.result.hitl?.replies[0]?.reply).toBe("operator reply other");
    expect(other.result.exitCode).toBe(0);
  });

  it("relays two gates in one session, in order", async () => {
    const { result, log, asked } = await run({
      mode: "two-gates",
      answers: [line("1"), line("Delta")],
    });
    expect(asked).toEqual(["demo", "second"]);
    expect(result.hitl?.replies.map((r) => r.line)).toEqual([
      "HITL_REPLY: demo | operator reply 1 | Alpha",
      "HITL_REPLY: second | operator reply 2 | Delta",
    ]);
    expect(log).toContain("received: HITL_REPLY: second | operator reply 2 | Delta");
    expect(result.exitCode).toBe(0);
  });

  it("detects a pre-sentinel numbered list through the prose fallback and records it as such", async () => {
    const { result, asked, terminal } = await run({ mode: "fallback", answers: [line("2")] });
    expect(asked).toEqual([FALLBACK_ASK_ID]);
    expect(result.hitl?.fallbackDetections).toBe(1);
    expect(result.hitl?.replies[0]?.line).toBe(
      "HITL_REPLY: prose-fallback | operator reply 2 | Beta",
    );
    expect(terminal).toContain("HITL gate (prose fallback, ask-id prose-fallback)");
    expect(formatHitlSummary(result.hitl)).toEqual([
      expect.stringMatching(/^HITL prose-fallback: operator reply 2 \(Beta\) .* \[fallback\]$/),
      "hitl-detect: prose-fallback x1",
    ]);
  });

  it.each([
    [{ kind: "eof" } as RawAnswer, "stopped-by-operator: gate demo, no reply (EOF)", 4],
    [line(""), "stopped-by-operator: gate demo, no reply (empty)", 4],
    [line("cancel"), "stopped-by-operator: gate demo, no reply (cancel)", 4],
    [line("skip"), "stopped-by-operator: gate demo, no reply (skip)", 4],
    [{ kind: "sigint" } as RawAnswer, "stopped-by-operator: gate demo, no reply (SIGINT)", 130],
  ])("stops without writing anything on %o", async (answer, message, code) => {
    const { result, log } = await run({ answers: [answer] });
    expect(result.hitl?.stop?.message).toBe(message);
    expect(result.hitl?.replies).toEqual([]);
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(code);
    expect(log).not.toContain("HITL_REPLY");
    expect(log).not.toContain("received:");
    // The child exited cleanly on stdin end (no signal needed).
    expect(result.exitCode).toBe(0);
  });

  it("--no-hitl never reads: a gate ends the run with exit 4 and no default answer", async () => {
    const { result, asked, log } = await run({ policy: "off", answers: [line("1")] });
    expect(asked).toEqual([]);
    expect(result.hitl?.stop?.message).toBe("stopped: unanswered gate (--no-hitl)");
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(HITL_UNANSWERED_EXIT_CODE);
    expect(log).not.toContain("HITL_REPLY");
  });

  it("a non-TTY stdin without --no-hitl does not block: honest stop, no read", async () => {
    const { result, asked } = await run({ isTTY: false, answers: [line("1")] });
    expect(asked).toEqual([]);
    expect(result.hitl?.stop?.message).toBe("stopped: unanswered gate (no TTY)");
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(4);
  });

  it("a reserved gate id is never relayed", async () => {
    const { result, asked } = await run({ mode: "reserved", answers: [line("1")] });
    expect(asked).toEqual([]);
    expect(result.hitl?.stop?.message).toBe(
      "stopped: gate git-prod is operator-gated; run the /git-prod slash yourself (never headless)",
    );
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(4);
  });

  it.each(["nogate", "tick"])(
    "a non-gate result (%s) ends stdin so the idle child exits; no prompt, no stop",
    async (mode) => {
      const { result, asked, log } = await run({ mode, answers: [line("1")] });
      expect(asked).toEqual([]);
      expect(result).toEqual({ exitCode: 0, hitl: { replies: [], fallbackDetections: 0 } });
      expect(log).toContain('"type":"result"');
    },
  );

  it("signals a child that ignores stdin end after the grace period", async () => {
    const started = Date.now();
    const { result } = await run({
      mode: "ignore-stdin-end",
      answers: [line("cancel")],
      killAfterMs: 150,
    });
    expect(result.hitl?.stop?.cause).toBe("cancel");
    // Killed by SIGTERM: no exit code from the child, reported as 1 by spawnLogged.
    expect(result.exitCode).toBe(1);
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(4);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("cursor-agent has no relay", () => {
  beforeEach(() => {
    vi.stubEnv("NO_COLOR", "1");
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("a gate on cursor-agent is an honest stop naming the missing capability; argv untouched", async () => {
    const logPath = await tmpLog();
    const spawnFn = vi.fn(fakeSpawn(FAKE_CURSOR));
    const scripted = scriptedReader([line("1")]);
    const result = await cursorAgentBackend.run({
      workspace: os.tmpdir(),
      prompt: "do work",
      logPath,
      env: { FAKE_CURSOR_AGENT_MODE: "gate" },
      spawnFn: spawnFn as unknown as SpawnFn,
      hitl: { isTTY: true, readAnswer: scripted.reader, write: () => {} },
    });
    expect(scripted.seen).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.hitl?.stop?.message).toBe(
      "stopped: unanswered gate (backend cursor-agent has no relay)",
    );
    expect(hitlExitCode(result.exitCode, result.hitl)).toBe(4);
    const args = spawnFn.mock.calls[0]?.[1] as string[];
    expect(args.at(-1)).toBe("do work");
    expect(args).not.toContain("--input-format");
    const opts = spawnFn.mock.calls[0]?.[2] as { stdio?: unknown };
    expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(await readFile(logPath, "utf8")).toContain("HITL_GATE: demo | Alpha | Beta");
  });

  it("a tick result on cursor-agent is not a gate", async () => {
    const logPath = await tmpLog();
    const result = await cursorAgentBackend.run({
      workspace: os.tmpdir(),
      prompt: "tick",
      logPath,
      env: { FAKE_CURSOR_AGENT_MODE: "nogate" },
      spawnFn: fakeSpawn(FAKE_CURSOR),
      hitl: { isTTY: true, readAnswer: async () => line("1"), write: () => {} },
    });
    expect(result).toEqual({ exitCode: 0, hitl: { replies: [], fallbackDetections: 0 } });
  });
});
