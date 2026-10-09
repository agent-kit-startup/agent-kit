import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentBackend, type HitlRunOptions, getBackend } from "./backends.js";
import {
  CODEX_CHATGPT_LOGIN_ENV,
  codexBackend,
  codexExecArgs,
  codexPrompt,
  codexResumeArgs,
  createCodexTranslator,
  resolveCodexAuth,
} from "./codex.js";
import type { RawAnswer } from "./hitl-relay.js";
import { TICK_PROMPT, runPlanLoop } from "./run-loop.js";
import { detectUsageLimit } from "./usage-limit.js";

type SpawnFn = typeof spawn;

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_CODEX = path.join(FIXTURES, "fake-codex.mjs");
const OPENAI_ENV = "OPENAI_API_KEY";
const seededKey = () => ["seeded", "openai", "v+1/x="].join("-");

function fakeSpawn(): SpawnFn {
  return ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
    spawn(process.execPath, [FAKE_CODEX, ...args], opts)) as unknown as SpawnFn;
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-codex-"));
  await mkdir(path.join(root, ".cursor", "commands"), { recursive: true });
  await mkdir(path.join(root, ".cursor", "plans"), { recursive: true });
  await writeFile(path.join(root, ".cursor", "commands", "run-plan.md"), "# /run-plan\n");
  return root;
}

function scripted(answers: RawAnswer[]): HitlRunOptions["readAnswer"] {
  return async () => {
    const next = answers.shift();
    if (!next) throw new Error("no scripted answer left");
    return next;
  };
}

interface Trace {
  args: string[];
  stdin: string;
}

async function readTrace(file: string): Promise<Trace[]> {
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Trace);
}

describe("codex argv and auth (contract)", () => {
  it("pins the exec and resume argv", () => {
    expect(codexExecArgs({ workspace: "/w" })).toEqual([
      "exec",
      "--json",
      "--color",
      "never",
      "--cd",
      "/w",
      "--dangerously-bypass-approvals-and-sandbox",
      "-",
    ]);
    expect(codexExecArgs({ workspace: "/w", model: "gpt-5" }).slice(-3)).toEqual([
      "--model",
      "gpt-5",
      "-",
    ]);
    expect(codexResumeArgs({ threadId: "t-1" })).toEqual([
      "exec",
      "resume",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "t-1",
      "-",
    ]);
  });

  it("API key by default; ChatGPT sign-in only behind the opt-in flag", () => {
    const refused = resolveCodexAuth({});
    expect(refused.mode).toBe("refused");
    expect(refused.mode === "refused" && refused.message).toContain(CODEX_CHATGPT_LOGIN_ENV);
    const key = seededKey();
    const api = resolveCodexAuth({ [OPENAI_ENV]: key });
    expect(api.mode).toBe("api-key");
    expect(api.mode === "api-key" && api.env.CODEX_API_KEY).toBe(key);
    expect(resolveCodexAuth({ [CODEX_CHATGPT_LOGIN_ENV]: "1" }).mode).toBe("chatgpt-login");
    expect(resolveCodexAuth({ [CODEX_CHATGPT_LOGIN_ENV]: "true" }).mode).toBe("refused");
  });

  it("a slash prompt gets the SoT pointer and stays verbatim; a missing SoT fails closed", async () => {
    const root = await workspace();
    const ok = await codexPrompt(root, TICK_PROMPT);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.prompt.startsWith("Read `.cursor/commands/run-plan.md` now")).toBe(true);
    expect(ok.prompt).toContain("HITL_GATE: <ask-id> | <label 1>");
    expect(ok.prompt.endsWith(`\n\n${TICK_PROMPT}`)).toBe(true);
    expect(await codexPrompt(root, "/no-such-command now")).toEqual({
      ok: false,
      missing: path.join(".cursor", "commands", "no-such-command.md"),
    });
    expect(await codexPrompt(root, "plain prompt")).toEqual({ ok: true, prompt: "plain prompt" });
  });
});

describe("codex JSONL translation", () => {
  it("maps thread, command, message and turn events to stream-json; accepts the legacy item_type", () => {
    const threads: string[] = [];
    const t = createCodexTranslator((id) => threads.push(id));
    const run = (event: unknown) => t(JSON.stringify(event)).map((l) => JSON.parse(l));
    expect(run({ type: "thread.started", thread_id: "th-1" })).toEqual([
      { type: "system", subtype: "init", session_id: "th-1", model: "codex" },
    ]);
    expect(threads).toEqual(["th-1"]);
    expect(
      run({ type: "item.started", item: { type: "command_execution", command: "ls" } })[0],
    ).toMatchObject({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "shell" }] },
    });
    expect(
      run({ type: "item.completed", item: { type: "command_execution", exit_code: 2 } })[0],
    ).toMatchObject({
      type: "user",
      message: { content: [{ type: "tool_result", is_error: true }] },
    });
    run({
      type: "item.completed",
      item: { item_type: "assistant_message", text: "LOOP_TICK_RESULT: continue" },
    });
    expect(run({ type: "turn.completed", usage: { input_tokens: 1 } })).toEqual([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "LOOP_TICK_RESULT: continue",
        session_id: "th-1",
        usage: { input_tokens: 1 },
      },
    ]);
    expect(run({ type: "turn.failed", error: { message: "boom" } })[0]).toMatchObject({
      type: "result",
      is_error: true,
      errors: ["boom"],
    });
    expect(t("not json")).toEqual([]);
    expect(run({ type: "turn.started" })).toEqual([]);
  });
});

describe("codex backend with the fake codex (resume relay)", () => {
  let trace: string;
  beforeEach(async () => {
    trace = path.join(await mkdtemp(path.join(os.tmpdir(), "agent-kit-codex-trace-")), "t.jsonl");
  });

  const base = async (mode: string, hitl: HitlRunOptions, extraEnv: NodeJS.ProcessEnv = {}) => {
    const root = await workspace();
    const logPath = path.join(root, "tick.log");
    const lines: string[] = [];
    const result = await codexBackend.run({
      workspace: root,
      prompt: TICK_PROMPT,
      logPath,
      spawnFn: fakeSpawn(),
      versionFn: () => "codex-cli 0.160.1",
      env: {
        [OPENAI_ENV]: seededKey(),
        FAKE_CODEX_MODE: mode,
        FAKE_CODEX_TRACE: trace,
        ...extraEnv,
      },
      log: (l) => lines.push(l),
      render: { feed: () => {}, end: () => {} },
      hitl,
    });
    return { result, log: await readFile(logPath, "utf8"), lines };
  };

  it("answers a gate by resuming the same thread with the stamp; one log, raw codex lines", async () => {
    const written: string[] = [];
    const { result, log, lines } = await base("gate", {
      isTTY: true,
      readAnswer: scripted([{ kind: "line", text: "2" }]),
      write: (t) => written.push(t),
    });
    expect(result.exitCode).toBe(0);
    expect(result.hitl?.replies.map((r) => r.line)).toEqual([
      "HITL_REPLY: demo | operator reply 2 | Beta",
    ]);
    expect(result.hitl?.stop).toBeUndefined();
    expect(result.lastResult?.resultText).toContain(
      "received: HITL_REPLY: demo | operator reply 2 | Beta",
    );
    expect(result.lastResult?.resultText).toContain("LOOP_TICK_RESULT: continue");

    const runs = await readTrace(trace);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(runs[0]?.stdin).toContain("Read `.cursor/commands/run-plan.md` now");
    expect(runs[0]?.stdin.endsWith(TICK_PROMPT)).toBe(true);
    expect(runs[1]?.args).toEqual([
      "exec",
      "resume",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "0199a000-fake-4000-8000-codexthread01",
      "-",
    ]);
    expect(runs[1]?.stdin).toBe("HITL_REPLY: demo | operator reply 2 | Beta");

    // Raw codex JSONL from both children, appended; no CLI-authored stamp line.
    expect(log.split("\n").filter((l) => l.includes('"thread.started"'))).toHaveLength(2);
    expect(log).not.toContain('"type":"result"');
    expect(written.join("")).toContain("→ HITL_REPLY: demo | operator reply 2 | Beta");
    expect(lines.join("\n")).toContain("codex exec --json");
    expect(lines.join("\n")).toContain("API key");
  });

  it("a non-TTY gate outside driver mode stops honestly and is never resumed", async () => {
    const { result } = await base("gate", { isTTY: false });
    expect(result.hitl?.stop?.cause).toBe("no TTY");
    expect(await readTrace(trace)).toHaveLength(1);
  });

  it("injects the API key into the child env as CODEX_API_KEY", async () => {
    const { result } = await base("auth", { policy: "off" });
    expect(result.lastResult?.resultText).toContain("CODEX_API_KEY set");
  });

  it("refuses to start without an API key unless the ChatGPT flag is on", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    vi.stubEnv("CODEX_API_KEY", undefined);
    try {
      await expect(
        codexBackend.run({
          workspace: await workspace(),
          prompt: TICK_PROMPT,
          logPath: path.join(os.tmpdir(), "never.log"),
          spawnFn: (() => {
            throw new Error("must not spawn");
          }) as unknown as SpawnFn,
          versionFn: () => null,
        }),
      ).rejects.toThrow(/API-key mode needs OPENAI_API_KEY/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a usage-limit failure is detected from the raw codex log", async () => {
    const { result, log } = await base("limit", { policy: "off" });
    expect(result.lastResult?.isError).toBe(true);
    expect(detectUsageLimit(log)).toMatchObject({ source: "result" });
  });

  it("is registered as an explicit backend", () => {
    expect(getBackend("codex")).toBe(codexBackend);
  });
});

describe("run-plan driver mode on codex (scripted no-TTY client)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it("completes a 3-to-do plan with one gate answered over stdin", async () => {
    const root = await workspace();
    const plan = path.join(root, ".cursor", "plans", "driver-fixture.plan.md");
    await writeFile(
      plan,
      "---\nname: Codex fixture\ntodos:\n  - id: one\n    status: pending\n  - id: two\n    status: pending\n  - id: three\n    status: pending\n---\n",
    );
    const backend: AgentBackend = {
      id: "codex",
      resolve: async () => "fake-codex",
      run: (o) =>
        codexBackend.run({
          ...o,
          spawnFn: fakeSpawn(),
          versionFn: () => "codex-cli 0.160.1",
          env: { [OPENAI_ENV]: seededKey(), FAKE_CODEX_MODE: "driver-plan", FAKE_CODEX_PLAN: plan },
        }),
    };
    const input = new PassThrough();
    let out = "";
    const write = (text: string) => {
      out += text;
      for (const l of text.split("\n").filter(Boolean)) {
        const ev = JSON.parse(l) as { type: string; askId?: string };
        if (ev.type === "hitl_gate") {
          input.write(`${JSON.stringify({ type: "hitl_reply", askId: ev.askId, reply: 1 })}\n`);
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
    const tickEnds = events.filter((e) => e.type === "tick_end");
    expect(tickEnds.map((e) => e.backend)).toEqual(["codex", "codex", "codex"]);
    expect(tickEnds[1]?.replies).toEqual([
      expect.objectContaining({ line: "HITL_REPLY: driver-demo | operator reply 1 | Proceed" }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: "run_end", exitCode: 0, pending: 0 });
    expect(await readFile(plan, "utf8")).not.toContain("status: pending");
  });
});
