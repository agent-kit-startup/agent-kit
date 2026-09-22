import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RedactingStreamBuffer, redactSecrets, spawnLogged } from "./backends.js";
import { firstLineOfContent, parseStreamLine, summarizeToolInput } from "./stream-events.js";
import { StreamRenderer, renderStreamEvent } from "./stream-render.js";

/**
 * Fixture provenance: `claude-stream-run-plan-all-queue-drift.log` is a
 * recorded `agent-kit run-plan-all` run on the `claude` backend
 * (`@dadado/agent-kit-cli` 5.9.0, claude 2.1.276, 2026-09-19) that ends on
 * the queue-drift numbered-list Ask. Hook bodies, tool outputs, thinking
 * signatures, the slash catalog, paths and plan names were replaced by
 * same-length placeholders; event types, keys and line lengths are the
 * recorded ones. `cursor-agent-stream-synthetic.log` is hand-written (no
 * cursor-agent run was recorded on the fixture host).
 */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const CLAUDE_FIXTURE = readFileSync(
  path.join(FIXTURES, "claude-stream-run-plan-all-queue-drift.log"),
  "utf8",
);
const CURSOR_SYNTHETIC_FIXTURE = readFileSync(
  path.join(FIXTURES, "cursor-agent-stream-synthetic.log"),
  "utf8",
);

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`);
const ANSI_ALL = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const PLAIN = { isTTY: false, env: {}, columns: 120 } as const;

/** Terminal sink for tests: collects everything a renderer writes. */
function sink(): { write: (s: string) => void; text: () => string } {
  const parts: string[] = [];
  return { write: (s) => void parts.push(s), text: () => parts.join("") };
}

function renderAll(text: string, opts: ConstructorParameters<typeof StreamRenderer>[0]): string {
  const out = sink();
  const renderer = new StreamRenderer({ ...opts, write: out.write });
  renderer.feed(text);
  renderer.end();
  return out.text();
}

describe("parseStreamLine", () => {
  it("returns unparsed for a non-JSON line and never throws", () => {
    expect(parseStreamLine("warn: something")).toEqual([{ kind: "unparsed" }]);
    expect(parseStreamLine("{not json")).toEqual([{ kind: "unparsed" }]);
    expect(parseStreamLine("")).toEqual([{ kind: "unparsed" }]);
    expect(parseStreamLine("[1,2]")).toEqual([{ kind: "unparsed" }]);
  });

  it("extracts assistant text and tool_use with a one-line argument summary", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading files." },
          { type: "thinking", thinking: "", signature: "x" },
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "cat  a.md\n| head", description: "Read" },
          },
          { type: "server_tool_use", name: "advisor", input: {} },
          { type: "advisor_tool_result", content: { encrypted_content: "zzz" } },
        ],
      },
    });
    expect(parseStreamLine(line)).toEqual([
      { kind: "text", text: "Reading files." },
      { kind: "tool_use", name: "Bash", summary: "cat a.md | head" },
      { kind: "tool_use", name: "advisor", summary: "" },
    ]);
  });

  it("summarizes tool input by well-known key, then compact JSON", () => {
    expect(summarizeToolInput({ file_path: "/a/b.ts", limit: 3 })).toBe("/a/b.ts");
    expect(summarizeToolInput({ description: "Explore", prompt: "long" })).toBe("Explore");
    expect(summarizeToolInput({ n: 1, flag: true })).toBe('{"n":1,"flag":true}');
    expect(summarizeToolInput("raw string")).toBe("raw string");
    expect(summarizeToolInput(undefined)).toBe("");
  });

  it("extracts tool_result as ok/error with the first non-empty line (string or parts)", () => {
    const ok = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "\n\n=== plan ===\nmore",
            is_error: false,
          },
        ],
      },
    });
    expect(parseStreamLine(ok)).toEqual([{ kind: "tool_result", ok: true, line: "=== plan ===" }]);
    const err = JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "t2",
            content: [{ type: "text", text: "Error: ENOENT\nstack" }],
            is_error: true,
          },
        ],
      },
    });
    expect(parseStreamLine(err)).toEqual([
      { kind: "tool_result", ok: false, line: "Error: ENOENT" },
    ]);
    expect(firstLineOfContent({ a: 1 })).toBe('{"a":1}');
    expect(firstLineOfContent(42)).toBe("");
  });

  it("collapses a replayed user prompt to its size", () => {
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "/run-plan-all body" }] },
      isReplay: true,
    });
    expect(parseStreamLine(line)).toEqual([{ kind: "prompt", chars: 18 }]);
    const big = JSON.stringify({
      type: "user",
      message: { role: "user", content: "x".repeat(40_000) },
      isReplay: true,
    });
    expect(parseStreamLine(big)).toEqual([{ kind: "prompt", chars: 40_000 }]);
  });

  it("shows a replayed HITL_REPLY stamp as the child's echo, not as a prompt size", () => {
    const stamp = "HITL_REPLY: queue-drift | operator reply 1 | Resume frozen queue";
    const asString = JSON.stringify({
      type: "user",
      message: { role: "user", content: stamp },
      isReplay: true,
    });
    expect(parseStreamLine(asString)).toEqual([{ kind: "hitl_reply", line: stamp }]);
    const asParts = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: stamp }] },
      isReplay: true,
    });
    expect(parseStreamLine(asParts)).toEqual([{ kind: "hitl_reply", line: stamp }]);
    // Not replayed (a prompt that merely starts with the prefix) stays a prompt.
    const notReplay = JSON.stringify({ type: "user", message: { role: "user", content: stamp } });
    expect(parseStreamLine(notReplay)).toEqual([{ kind: "prompt", chars: stamp.length }]);
    expect(
      renderStreamEvent({ kind: "hitl_reply", line: stamp }, { color: false, columns: 120 }),
    ).toBe(`\u21a9 ${stamp}`);
  });

  it("extracts result status, cost, durations and turns; errors keep their subtype", () => {
    const ok = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      total_cost_usd: 2.05581725,
      duration_ms: 142520,
      duration_api_ms: 142993,
      num_turns: 11,
      result: "text",
    });
    expect(parseStreamLine(ok)).toEqual([
      {
        kind: "result",
        ok: true,
        status: "success",
        costUsd: 2.05581725,
        durationMs: 142520,
        apiMs: 142993,
        turns: 11,
      },
    ]);
    const err = JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true });
    expect(parseStreamLine(err)).toEqual([
      { kind: "result", ok: false, status: "error_max_turns" },
    ]);
    expect(parseStreamLine('{"type":"result","is_error":true}')).toEqual([
      { kind: "result", ok: false, status: "error" },
    ]);
  });

  it("collapses hook events to one line each and silences other system events", () => {
    expect(
      parseStreamLine(
        JSON.stringify({
          type: "system",
          subtype: "hook_started",
          hook_name: "SessionStart:startup",
        }),
      ),
    ).toEqual([{ kind: "hook", name: "SessionStart:startup", phase: "started", detail: "" }]);
    expect(
      parseStreamLine(
        JSON.stringify({
          type: "system",
          subtype: "hook_response",
          hook_name: "SessionStart:startup",
          outcome: "success",
          exit_code: 0,
          stdout: "x".repeat(50_000),
        }),
      ),
    ).toEqual([
      { kind: "hook", name: "SessionStart:startup", phase: "response", detail: "success, exit 0" },
    ]);
    for (const subtype of ["init", "commands_changed", "thinking_tokens"]) {
      expect(parseStreamLine(JSON.stringify({ type: "system", subtype }))).toEqual([
        { kind: "silent" },
      ]);
    }
    expect(parseStreamLine('{"type":"stream_event","event":{}}')).toEqual([{ kind: "silent" }]);
  });

  it("turns rate_limit_event into a warning line, severe when not allowed", () => {
    const allowed = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        rateLimitType: "five_hour",
        unifiedWindows: { five_hour: { utilization: 0.01 }, seven_day: { utilization: 0.06 } },
      },
    });
    expect(parseStreamLine(allowed)).toEqual([
      {
        kind: "rate_limit",
        line: "five_hour · allowed · five_hour 1% · seven_day 6%",
        severe: false,
      },
    ]);
    const rejected = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", rateLimitType: "five_hour" },
    });
    expect(parseStreamLine(rejected)).toEqual([
      { kind: "rate_limit", line: "five_hour · rejected", severe: true },
    ]);
  });

  it("maps cursor-agent tool_call started/completed onto tool_use/tool_result", () => {
    const started = JSON.stringify({
      type: "tool_call",
      subtype: "started",
      tool_call: { shellToolCall: { args: { command: "pnpm test" } } },
    });
    expect(parseStreamLine(started)).toEqual([
      { kind: "tool_use", name: "shell", summary: "pnpm test" },
    ]);
    const completedOk = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: {
        readToolCall: { args: { path: "a" }, result: { success: { content: "# H\nb" } } },
      },
    });
    expect(parseStreamLine(completedOk)).toEqual([
      { kind: "tool_result", ok: true, line: '{"content":"# H\\nb"}' },
    ]);
    const completedErr = JSON.stringify({
      type: "tool_call",
      subtype: "completed",
      tool_call: { shellToolCall: { args: {}, result: { error: "exit 1" } } },
    });
    expect(parseStreamLine(completedErr)).toEqual([
      { kind: "tool_result", ok: false, line: "exit 1" },
    ]);
    expect(
      parseStreamLine(JSON.stringify({ type: "tool_call", subtype: "unknown", tool_call: {} })),
    ).toEqual([{ kind: "silent" }]);
  });
});

describe("renderStreamEvent", () => {
  const plain = { color: false, columns: 80 };

  it("renders each event kind as one status line without ANSI in plain mode", () => {
    expect(renderStreamEvent({ kind: "tool_use", name: "Bash", summary: "ls" }, plain)).toBe(
      "✧ Bash · ls",
    );
    expect(renderStreamEvent({ kind: "tool_use", name: "advisor", summary: "" }, plain)).toBe(
      "✧ advisor",
    );
    expect(renderStreamEvent({ kind: "tool_result", ok: true, line: "done" }, plain)).toBe(
      "  · ok · done",
    );
    expect(renderStreamEvent({ kind: "tool_result", ok: false, line: "" }, plain)).toBe(
      "  · error",
    );
    expect(
      renderStreamEvent(
        {
          kind: "result",
          ok: true,
          status: "success",
          costUsd: 2.0558,
          durationMs: 142520,
          turns: 11,
        },
        plain,
      ),
    ).toBe("✦ result success · $2.06 · 2m 23s · 11 turns");
    expect(
      renderStreamEvent(
        {
          kind: "result",
          ok: false,
          status: "error_max_turns",
          costUsd: 0.0123,
          apiMs: 950,
          turns: 1,
        },
        plain,
      ),
    ).toBe("✦ result error_max_turns · $0.0123 · 950ms api · 1 turn");
    expect(
      renderStreamEvent(
        { kind: "hook", name: "SessionStart", phase: "response", detail: "exit 0" },
        plain,
      ),
    ).toBe("· hook SessionStart response (exit 0)");
    expect(renderStreamEvent({ kind: "rate_limit", line: "x", severe: false }, plain)).toBe(
      "! rate limit · x",
    );
    expect(renderStreamEvent({ kind: "prompt", chars: 12 }, plain)).toBe(
      "· prompt sent · 12 chars",
    );
    expect(renderStreamEvent({ kind: "text", text: "hi\n" }, plain)).toBe("hi\n");
    expect(renderStreamEvent({ kind: "silent" }, plain)).toBeNull();
    expect(renderStreamEvent({ kind: "unparsed" }, plain)).toBeNull();
  });

  it("truncates one-line summaries to the terminal width", () => {
    const long = "x".repeat(500);
    const line = renderStreamEvent({ kind: "tool_use", name: "Bash", summary: long }, plain);
    expect(line?.length).toBeLessThanOrEqual(80);
    expect(line?.endsWith("…")).toBe(true);
  });

  it("paints status lines with ANSI when color is on", () => {
    const colored = renderStreamEvent(
      { kind: "tool_use", name: "Bash", summary: "ls" },
      { color: true, columns: 80 },
    );
    expect(colored).toMatch(ANSI);
    expect(colored?.replace(ANSI_ALL, "")).toBe("✧ Bash · ls");
  });
});

describe("StreamRenderer", () => {
  const stream = [
    '{"type":"system","subtype":"init","cwd":"/w"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.md"}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","content":"# A","is_error":false}]}}',
    "not json at all",
    '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.5,"duration_ms":1500,"num_turns":2}',
    "",
  ].join("\n");
  const expectedPlain = [
    "Hello",
    "✧ Read · a.md",
    "  · ok · # A",
    "✦ result success · $0.50 · 1.5s · 2 turns",
    "",
  ].join("\n");

  it("renders status lines in plain mode (non-TTY) and closes an open text line", () => {
    expect(renderAll(stream, PLAIN)).toBe(expectedPlain);
  });

  it("is plain under NO_COLOR or CI even on a TTY, colored on a TTY otherwise", () => {
    expect(renderAll(stream, { isTTY: true, env: { NO_COLOR: "1" }, columns: 120 })).toBe(
      expectedPlain,
    );
    expect(renderAll(stream, { isTTY: true, env: { CI: "true" }, columns: 120 })).toBe(
      expectedPlain,
    );
    expect(renderAll(stream, { isTTY: true, env: { FORCE_COLOR: "0" }, columns: 120 })).toBe(
      expectedPlain,
    );
    const tty = renderAll(stream, { isTTY: true, env: {}, columns: 120 });
    expect(tty).toMatch(ANSI);
    expect(tty.replace(ANSI_ALL, "")).toBe(expectedPlain);
    expect(renderAll(stream, { isTTY: false, env: {}, columns: 120 })).not.toMatch(ANSI);
  });

  it("produces the same output for any chunking, including one-byte chunks and Buffers", () => {
    const whole = renderAll(stream, PLAIN);
    const out = sink();
    const renderer = new StreamRenderer({ ...PLAIN, write: out.write });
    const bytes = Buffer.from(`${stream}é`, "utf8");
    for (let i = 0; i < bytes.length; i += 1) renderer.feed(bytes.subarray(i, i + 1));
    renderer.end();
    expect(out.text()).toBe(whole);
  });

  it("renders nothing for unparseable lines and contains a failing writer", () => {
    expect(renderAll("plain text\n{broken\n", PLAIN)).toBe("");
    const renderer = new StreamRenderer({
      ...PLAIN,
      write: () => {
        throw new Error("EPIPE");
      },
    });
    expect(() => renderer.feed(stream)).not.toThrow();
    expect(() => renderer.end()).not.toThrow();
  });

  it("keeps streamed assistant text fragments on one line until a status line follows", () => {
    const out = renderAll(CURSOR_SYNTHETIC_FIXTURE, PLAIN);
    expect(out).toBe(
      [
        "· prompt sent · 30 chars",
        "Reading the plan and the handoff.",
        "✧ read · /work/consumer/.cursor/HANDOFF.md",
        '  · ok · {"content":"# Handoff\\n- Plan: placeholder.plan.md","totalLines":2}',
        "✧ shell · pnpm test",
        '  · error · {"message":"command exited with code 1","stderr":"1 test failed"}',
        "One test failed; stopping this tick.",
        "",
        "LOOP_TICK_RESULT: stop — tests red",
        "✦ result success · 4.2s",
        "",
      ].join("\n"),
    );
  });
});

describe("recorded claude run (queue-drift Ask fixture)", () => {
  const rendered = renderAll(CLAUDE_FIXTURE, PLAIN);
  const lines = rendered.split("\n");

  it("shows hooks, tool calls, results, rate limits and the final Ask, never raw NDJSON", () => {
    expect(rendered).not.toMatch(/\{"type":/);
    expect(rendered).not.toContain("placeholder line 1 of the session hook stdout");
    expect(rendered).not.toContain("signature");
    expect(rendered).not.toContain("encrypted");
    expect(rendered).not.toContain("thinking");
    expect(lines[0]).toBe("· hook SessionStart:startup started");
    expect(lines[1]).toBe("· hook SessionStart:startup progress");
    expect(lines[2]).toBe("· hook SessionStart:startup response (success, exit 0)");
    expect(lines[3]).toBe("! rate limit · five_hour · allowed · five_hour 0% · seven_day 6%");
    expect(lines[4]).toBe(
      "I'll start by orienting on the current state — HANDOFF, plan index, and recent history.",
    );
    expect(lines[5]).toBe(
      '✧ Bash · echo "=== HANDOFF ===" && cat .cursor/HANDOFF.md 2>/dev/null | head -120',
    );
    expect(lines[6]).toBe("  · ok · # tool output (placeholder, same length as the recorded body)");
    expect(lines.filter((l) => l.startsWith("✧ Bash")).length).toBe(10);
    expect(lines.filter((l) => l.startsWith("  · ok")).length).toBe(10);
    expect(lines).toContain("✧ advisor");
    expect(lines.filter((l) => l.startsWith("! rate limit")).length).toBe(2);
    expect(rendered).toContain("**Queue drift — how should I proceed?** (reply with a number)");
    expect(rendered).toContain("1. **Resume frozen queue**");
    expect(rendered).toContain("3. **Re-synthesize**");
    expect(lines.at(-2)).toBe("✦ result success · $2.06 · 2m 23s · 11 turns");
    expect(lines.at(-1)).toBe("");
    // The final assistant text is printed once; the result event adds status only.
    expect(rendered.split("**Queue drift — how should I proceed?**").length).toBe(2);
  });

  it("renders the same lines when fed through RedactingStreamBuffer at arbitrary chunk sizes", () => {
    // A value that occurs in the fixture stands in for a secret; the two
    // 80 KB hook lines exceed the buffer's hold limit, so this also covers
    // the partial-line path the buffer takes past REDACT_HOLD_MAX_CHARS.
    const secrets = [{ label: "SECRET", value: "plan-delta" }];
    const expected = renderAll(redactSecrets(CLAUDE_FIXTURE, secrets), PLAIN);
    expect(expected).toContain("[SECRET]");
    expect(expected).not.toContain("plan-delta");
    const bytes = Buffer.from(CLAUDE_FIXTURE, "utf8");
    for (const size of [1024, 7001, 65_536, 100_000]) {
      const buffer = new RedactingStreamBuffer(secrets);
      const out = sink();
      const renderer = new StreamRenderer({ ...PLAIN, write: out.write });
      for (let i = 0; i < bytes.length; i += size) {
        renderer.feed(buffer.push(bytes.subarray(i, i + size)));
      }
      renderer.feed(buffer.flush());
      renderer.end();
      expect(out.text(), `chunk size ${size}`).toBe(expected);
    }
  });

  it("is what spawnLogged sends to the terminal while the log keeps the full NDJSON", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-stream-render-"));
    const logPath = path.join(dir, "run.log");
    const spawnFn = (() => {
      const ee = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      ee.stdout = new EventEmitter();
      ee.stderr = new EventEmitter();
      queueMicrotask(() => {
        const bytes = Buffer.from(CLAUDE_FIXTURE, "utf8");
        for (let i = 0; i < bytes.length; i += 4096)
          ee.stdout.emit("data", bytes.subarray(i, i + 4096));
        ee.stderr.emit("data", Buffer.from("warn: not json\n"));
        ee.emit("close", 0);
      });
      return ee;
    }) as unknown as typeof spawn;
    const terminal = sink();
    const result = await spawnLogged("claude", ["-p"], logPath, {
      spawnFn,
      redact: [{ label: "SECRET", value: "plan-delta" }],
      render: new StreamRenderer({ ...PLAIN, write: terminal.write }),
    });
    expect(result).toEqual({ exitCode: 0 });
    const logText = await readFile(logPath, "utf8");
    expect(logText).toBe(
      `${redactSecrets(CLAUDE_FIXTURE, [{ label: "SECRET", value: "plan-delta" }])}warn: not json\n`,
    );
    expect(terminal.text()).toBe(
      renderAll(redactSecrets(CLAUDE_FIXTURE, [{ label: "SECRET", value: "plan-delta" }]), PLAIN),
    );
    expect(terminal.text()).not.toMatch(/\{"type":/);
  });
});
