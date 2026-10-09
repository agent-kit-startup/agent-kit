import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentBackend, type HitlRunOptions, getBackend } from "./backends.js";
import {
  CURSOR_ASK_QUESTION_ID,
  acpInitializeParams,
  acpPermissionOutcome,
  acpQuestions,
  cursorAcpArgs,
  cursorAcpBackend,
} from "./cursor-acp.js";
import type { RawAnswer } from "./hitl-relay.js";
import { TICK_PROMPT, runPlanLoop } from "./run-loop.js";
import { detectUsageLimit } from "./usage-limit.js";

type SpawnFn = typeof spawn;

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ACP = path.join(FIXTURES, "fake-cursor-acp.mjs");
const RECORDED_INIT = path.join(FIXTURES, "cursor-acp-initialize-2026.10.01.json");

function fakeSpawn(seen?: string[][]): SpawnFn {
  return ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) => {
    seen?.push(args);
    return spawn(process.execPath, [FAKE_ACP, ...args], opts);
  }) as unknown as SpawnFn;
}

function scripted(answers: RawAnswer[]): HitlRunOptions["readAnswer"] {
  return async () => {
    const next = answers.shift();
    if (!next) throw new Error("no scripted answer left");
    return next;
  };
}

async function run(mode: string, hitl: HitlRunOptions, extraEnv: NodeJS.ProcessEnv = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-acp-"));
  const logPath = path.join(dir, "tick.log");
  const trace = path.join(dir, "trace.jsonl");
  const written: string[] = [];
  const rendered: string[] = [];
  const argv: string[][] = [];
  const result = await cursorAcpBackend.run({
    workspace: dir,
    prompt: TICK_PROMPT,
    logPath,
    spawnFn: fakeSpawn(argv),
    env: { FAKE_CURSOR_ACP_MODE: mode, FAKE_CURSOR_ACP_TRACE: trace, ...extraEnv },
    log: () => {},
    render: { feed: (t) => rendered.push(String(t)), end: () => {} },
    hitl: { write: (t) => written.push(t), ...hitl },
  });
  const received = (await readFile(trace, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map(
      (l) =>
        JSON.parse(l) as {
          id?: number;
          method?: string;
          params?: unknown;
          result?: unknown;
          error?: unknown;
        },
    );
  return {
    result,
    log: await readFile(logPath, "utf8"),
    written,
    rendered: rendered.join(""),
    received,
    argv,
    dir,
  };
}

describe("cursor-acp protocol pieces (contract)", () => {
  it("spawns the documented `acp` mode only and initializes with no fs/terminal capability", async () => {
    expect(cursorAcpArgs()).toEqual(["acp"]);
    const recorded = JSON.parse(await readFile(RECORDED_INIT, "utf8")) as {
      request: { params: { protocolVersion: number; clientCapabilities: unknown } };
      response: { result: { protocolVersion: number; authMethods: { id: string }[] } };
    };
    const params = acpInitializeParams();
    expect(params.protocolVersion).toBe(recorded.response.result.protocolVersion);
    expect(params.clientCapabilities).toEqual(recorded.request.params.clientCapabilities);
    expect(recorded.response.result.authMethods.map((m) => m.id)).toEqual(["cursor_login"]);
  });

  it("answers permission requests allow-once (parity with --force), else cancelled", () => {
    expect(
      acpPermissionOutcome({
        options: [
          { optionId: "reject-once", kind: "reject_once" },
          { optionId: "allow-once", kind: "allow_once" },
        ],
      }),
    ).toEqual({ outcome: { outcome: "selected", optionId: "allow-once" } });
    expect(
      acpPermissionOutcome({ options: [{ optionId: "allow-always", kind: "allow_always" }] }),
    ).toEqual({
      outcome: { outcome: "selected", optionId: "allow-always" },
    });
    expect(acpPermissionOutcome({ options: [{ optionId: "reject-once" }] })).toEqual({
      outcome: { outcome: "cancelled" },
    });
  });

  it("reads ask_question options and keeps `|` out of gate labels", () => {
    expect(
      acpQuestions({
        questions: [
          { id: "q1", options: [{ id: "a", label: "A | B" }, { id: "b" }] },
          { id: "q2", options: [] },
        ],
      }),
    ).toEqual([
      {
        id: "q1",
        prompt: "",
        options: [
          { id: "a", label: "A / B" },
          { id: "b", label: "b" },
        ],
      },
    ]);
  });

  it("is an explicit backend that resolves the installed cursor-agent binary", () => {
    expect(getBackend("cursor-acp")).toBe(cursorAcpBackend);
  });
});

describe("cursor-acp backend with the fake ACP agent", () => {
  it("relays a HITL_GATE split across chunks; the stamp is the next session/prompt in the same session", async () => {
    const { result, log, written, received, argv } = await run("gate", {
      isTTY: true,
      readAnswer: scripted([{ kind: "line", text: "Beta" }]),
    });
    expect(argv).toEqual([["acp"]]);
    expect(result.exitCode).toBe(0);
    expect(result.hitl?.replies.map((r) => r.line)).toEqual([
      "HITL_REPLY: demo | operator reply 2 | Beta",
    ]);
    expect(result.lastResult?.resultText).toContain(
      "received: HITL_REPLY: demo | operator reply 2 | Beta",
    );
    expect(result.lastResult?.resultText).toContain("LOOP_TICK_RESULT: continue");
    expect(received.map((m) => m.method).filter(Boolean)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "session/prompt",
      "session/prompt",
    ]);
    const prompts = received.filter((m) => m.method === "session/prompt");
    expect(JSON.stringify(prompts[0]?.params)).toContain("fake-acp-session-0001");
    expect(JSON.stringify(prompts[1]?.params)).toContain(
      "HITL_REPLY: demo | operator reply 2 | Beta",
    );
    // Both directions in the log.
    expect(log).toContain('"method":"initialize"');
    expect(log).toContain('"sessionUpdate":"agent_message_chunk"');
    expect(written.join("")).toContain("→ HITL_REPLY: demo | operator reply 2 | Beta");
  });

  it("answers tool permission requests allow-once", async () => {
    const { result, received } = await run("permission", { policy: "off" });
    expect(result.lastResult?.resultText).toContain("permission: allow-once");
    expect(received.find((m) => m.id === 1000)?.result).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    });
  });

  it("relays cursor/ask_question as a gate and answers with the chosen option id", async () => {
    const seen: string[] = [];
    const { result } = await run("ask", {
      isTTY: true,
      readAnswer: async (gate) => {
        seen.push(`${gate.askId}: ${gate.labels.join(", ")}`);
        return { kind: "line", text: "2" };
      },
    });
    expect(seen).toEqual([`${CURSOR_ASK_QUESTION_ID}: Agent, Plan`]);
    expect(result.lastResult?.resultText).toContain("answered: plan");
    expect(result.hitl?.replies[0]?.line).toBe(
      `HITL_REPLY: ${CURSOR_ASK_QUESTION_ID} | operator reply 2 | Plan`,
    );
  });

  it("an ask_question with no reply (no TTY) cancels and stops honestly", async () => {
    const { result, received } = await run("ask", { isTTY: false });
    expect(result.hitl?.stop?.cause).toBe("no TTY");
    expect(received.find((m) => m.id === 1000)?.result).toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(received.some((m) => m.method === "session/cancel")).toBe(true);
  });

  it("cursor/create_plan gets method-not-found (reject shape undocumented)", async () => {
    const { result } = await run("create-plan", { policy: "off" });
    expect(result.lastResult?.resultText).toContain("create_plan error: -32601");
  });

  it("a failed sign-in is an error result that names `cursor-agent login` (no credential handling)", async () => {
    const { result } = await run("auth-fail", { policy: "off" });
    expect(result.exitCode).toBe(1);
    expect(result.lastResult?.isError).toBe(true);
    expect(result.lastResult?.resultText).toContain("cursor-agent login");
  });

  it("a usage-limit JSON-RPC error is an error result and a usage-limit stop in the log", async () => {
    const { result, log } = await run("limit", { policy: "off" });
    expect(result.lastResult?.isError).toBe(true);
    expect(detectUsageLimit(log)).toMatchObject({ source: "result" });
  });

  it("signals an agent that keeps running after stdin ends (measured on cursor-agent 2026.10.01)", async () => {
    const started = Date.now();
    const { result } = await run("permission", { policy: "off" }, { FAKE_CURSOR_ACP_LINGER: "1" });
    expect(result.exitCode).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("run-plan driver mode on cursor-acp (scripted no-TTY client)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it("completes a 3-to-do plan with one gate answered over stdin", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-acp-plan-"));
    await mkdir(path.join(root, ".cursor", "plans"), { recursive: true });
    const plan = path.join(root, ".cursor", "plans", "driver-fixture.plan.md");
    await writeFile(
      plan,
      "---\nname: ACP fixture\ntodos:\n  - id: one\n    status: pending\n  - id: two\n    status: pending\n  - id: three\n    status: pending\n---\n",
    );
    const backend: AgentBackend = {
      id: "cursor-acp",
      resolve: async () => "fake-cursor-agent",
      run: (o) =>
        cursorAcpBackend.run({
          ...o,
          spawnFn: fakeSpawn(),
          env: { FAKE_CURSOR_ACP_MODE: "driver-plan", FAKE_CURSOR_ACP_PLAN: plan },
        }),
    };
    const input = new PassThrough();
    let out = "";
    const write = (text: string) => {
      out += text;
      for (const l of text.split("\n").filter(Boolean)) {
        const ev = JSON.parse(l) as { type: string; askId?: string };
        if (ev.type === "hitl_gate") {
          input.write(
            `${JSON.stringify({ type: "hitl_reply", askId: ev.askId, reply: "Proceed" })}\n`,
          );
        }
      }
    };
    const code = await runPlanLoop({
      root,
      maxTicks: 5,
      sleepSeconds: 0,
      dryRun: false,
      backend,
      events: { input, write, writeErr: () => {} },
    });
    expect(code).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
    const events = out
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.filter((e) => e.type === "hitl_gate")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tick_end").map((e) => e.backend)).toEqual([
      "cursor-acp",
      "cursor-acp",
      "cursor-acp",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run_end", exitCode: 0, pending: 0 });
    expect(await readFile(plan, "utf8")).not.toContain("status: pending");
  });
});
