import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectRunLogs, summarizeRunLog } from "../../../../dashboard/lib/run-logs.mjs";

const here = resolve(fileURLToPath(import.meta.url), "..");
const claudeFixture = readFileSync(
  resolve(here, "../plan-loop/fixtures/claude-stream-run-plan-all-queue-drift.log"),
  "utf8",
);
const j = (v: unknown) => JSON.stringify(v);

describe("summarizeRunLog", () => {
  it("reads a recorded claude stream-json run: session, last text, gate-less result", () => {
    const s = summarizeRunLog(claudeFixture);
    expect(s.format).toBe("stream-json");
    expect(s.sessionId).toMatch(/\S+/);
    expect(s.events).toBeGreaterThan(5);
    expect(s.result).not.toBeNull();
    expect(s.lastText.length).toBeGreaterThan(0);
    expect(s.lastText.length).toBeLessThanOrEqual(600);
  });

  it("stream-json: gate ids, child-replayed reply stamps and the tick sentinel", () => {
    const log = [
      j({ type: "system", subtype: "init", session_id: "s-1" }),
      j({
        type: "assistant",
        message: { content: [{ type: "text", text: "HITL_GATE: demo | A | B\n1. A\n2. B" }] },
      }),
      j({
        type: "user",
        isReplay: true,
        message: { content: "HITL_REPLY: demo | operator reply 1 | A" },
      }),
      j({
        type: "result",
        is_error: false,
        subtype: "success",
        result: "Done.\n\nLOOP_TICK_RESULT: continue",
      }),
    ].join("\n");
    expect(summarizeRunLog(log)).toMatchObject({
      format: "stream-json",
      sessionId: "s-1",
      gates: ["demo"],
      replies: ["HITL_REPLY: demo | operator reply 1 | A"],
      sentinel: "LOOP_TICK_RESULT: continue",
      result: { isError: false, subtype: "success" },
    });
  });

  it("codex exec --json", () => {
    const log = [
      j({ type: "thread.started", thread_id: "th-9" }),
      j({
        type: "item.completed",
        item: { type: "agent_message", text: "LOOP_TICK_RESULT: stop - plan exhausted" },
      }),
      j({ type: "turn.completed", usage: {} }),
    ].join("\n");
    expect(summarizeRunLog(log)).toMatchObject({
      format: "codex",
      sessionId: "th-9",
      sentinel: "LOOP_TICK_RESULT: stop - plan exhausted",
      result: { isError: false },
    });
  });

  it("cursor-acp JSON-RPC transcript: chunks joined per turn, reply from the client prompt", () => {
    const chunk = (text: string) =>
      j({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
        },
      });
    const log = [
      j({ jsonrpc: "2.0", id: 3, result: { sessionId: "acp-1" } }),
      chunk("HITL_GA"),
      chunk("TE: pick | X | Y\n1. X\n2. Y"),
      j({ jsonrpc: "2.0", id: 4, result: { stopReason: "end_turn" } }),
      j({
        jsonrpc: "2.0",
        id: 5,
        method: "session/prompt",
        params: {
          sessionId: "acp-1",
          prompt: [{ type: "text", text: "HITL_REPLY: pick | operator reply 2 | Y" }],
        },
      }),
      chunk("ok\n\nLOOP_TICK_RESULT: continue"),
      j({ jsonrpc: "2.0", id: 5, result: { stopReason: "end_turn" } }),
    ].join("\n");
    expect(summarizeRunLog(log)).toMatchObject({
      format: "acp",
      sessionId: "acp-1",
      gates: ["pick"],
      replies: ["HITL_REPLY: pick | operator reply 2 | Y"],
      sentinel: "LOOP_TICK_RESULT: continue",
      result: { isError: false, subtype: "end_turn" },
    });
  });

  it("applies the caller's redaction to every returned string and never throws on junk", () => {
    const log = j({ type: "result", is_error: true, result: "token=abc123 failed" });
    const s = summarizeRunLog(`not json\n{broken\n${log}`, (t: string) =>
      t.replace("abc123", "***"),
    );
    expect(s.result?.text).toBe("token=*** failed");
    expect(s.lastText).toBe("token=*** failed");
  });
});

describe("collectRunLogs", () => {
  it("lists the newest tick/run logs under <root>/.cursor/loop-logs, newest first, capped", () => {
    const root = mkdtempSync(join(tmpdir(), "ak-runlogs-"));
    const dir = join(root, ".cursor", "loop-logs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tick-20261008-100000000.log"), claudeFixture);
    writeFileSync(join(dir, "run-20261008-110000000.log"), j({ type: "result", result: "x" }));
    writeFileSync(join(dir, "notes.txt"), "ignored");
    utimesSync(join(dir, "tick-20261008-100000000.log"), 1000, 1000);
    const rows = collectRunLogs(root);
    expect(rows.map((r) => [r.id, r.kind, r.source])).toEqual([
      ["run-20261008-110000000.log", "run", "loop-logs"],
      ["tick-20261008-100000000.log", "tick", "loop-logs"],
    ]);
    expect(rows[1]?.path).toBe(".cursor/loop-logs/tick-20261008-100000000.log");
    expect(collectRunLogs(root, { max: 1 })).toHaveLength(1);
    expect(collectRunLogs(join(root, "missing"))).toEqual([]);
  });
});
