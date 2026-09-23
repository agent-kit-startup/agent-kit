import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_ENV_PASSTHROUGH,
  CLAUDE_MAX_BUDGET_USD_ENV,
  CLAUDE_MAX_TURNS_ENV,
  CLAUDE_MIN_VERSION,
  CLAUDE_NESTED_SESSION_KEYS,
  RedactingStreamBuffer,
  checkClaudeVersion,
  claudeBackend,
  claudeChildEnv,
  claudeHeadlessArgs,
  claudeRedactions,
  claudeRunCaps,
  claudeTickArgs,
  cursorAgentBackend,
  cursorAgentHeadlessArgs,
  getBackend,
  listBackendIds,
  mergeChildEnv,
  missingClaudeAdapter,
  parseClaudeVersion,
  redactSecrets,
  resetClaudeVersionCache,
  spawnLogged,
} from "./backends.js";

type SpawnFn = typeof spawn;

function mockSpawn(input: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /** Emitted as separate `data` events (chunk-boundary cases). */
  stdoutChunks?: (string | Buffer)[];
  stderrChunks?: (string | Buffer)[];
  error?: Error;
  /** Thrown synchronously from spawn itself (e.g. invalid cwd, EACCES). */
  throwSync?: Error;
}) {
  return vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
    if (input.throwSync) throw input.throwSync;
    const ee = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter & { writes: string[]; ended: boolean };
      kill: () => boolean;
    };
    ee.stdout = new EventEmitter();
    ee.stderr = new EventEmitter();
    // Recording stdin: the claude transport writes the prompt and the relay
    // replies here; `end()` is what lets a stream-json child exit.
    const writes: string[] = [];
    const stdin = Object.assign(new EventEmitter(), {
      writes,
      ended: false,
      write(chunk: string | Buffer) {
        writes.push(String(chunk));
        return true;
      },
      end() {
        this.ended = true;
      },
    });
    ee.stdin = stdin;
    ee.kill = () => true;
    queueMicrotask(() => {
      if (input.error) {
        ee.emit("error", input.error);
        return;
      }
      if (input.stdout) ee.stdout.emit("data", Buffer.from(input.stdout));
      for (const chunk of input.stdoutChunks ?? []) {
        ee.stdout.emit("data", typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      if (input.stderr) ee.stderr.emit("data", Buffer.from(input.stderr));
      for (const chunk of input.stderrChunks ?? []) {
        ee.stderr.emit("data", typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      ee.emit("close", input.exitCode ?? 0);
    });
    return ee as unknown as ReturnType<SpawnFn>;
  });
}

/** Deterministic `claude --version` for the backend tests (no real binary needed). */
const versionOk = () => "2.1.261 (Claude Code)";

/** The recording stdin of the first mocked child. */
function stdinOf(spawnFn: ReturnType<typeof mockSpawn>): { writes: string[]; ended: boolean } {
  const child = spawnFn.mock.results[0]?.value as { stdin: { writes: string[]; ended: boolean } };
  return child.stdin;
}

/** Spawn options as received by the mock; asserted field by field so a
 * failing expectation never prints the whole inherited process.env. */
function spawnOptsOf(spawnFn: ReturnType<typeof mockSpawn>): {
  cwd?: string;
  stdio?: unknown;
  env?: NodeJS.ProcessEnv;
} {
  return (spawnFn.mock.calls[0]?.[2] ?? {}) as {
    cwd?: string;
    stdio?: unknown;
    env?: NodeJS.ProcessEnv;
  };
}

async function tmpLog(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-backends-"));
  return path.join(dir, "tick.log");
}

const TOKEN = "sk-ant-test-token+abc/def=";
const BASE_URL = "https://gateway.example/anthropic";
const API_KEY = "anthropic-test-api-key-0123456789";

describe("backend table", () => {
  it("lists both backends and resolves claude without throwing", () => {
    expect(listBackendIds()).toEqual(["cursor-agent", "claude"]);
    expect(getBackend("claude")).toBe(claudeBackend);
    expect(getBackend("cursor-agent")).toBe(cursorAgentBackend);
    expect(() => getBackend("glm")).toThrow(/Unknown backend 'glm'/);
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence with the key label, longest first", () => {
    const text = `url=${BASE_URL} token=${TOKEN} again ${TOKEN}`;
    const out = redactSecrets(text, [
      { label: "ANTHROPIC_AUTH_TOKEN", value: TOKEN },
      { label: "ANTHROPIC_BASE_URL", value: BASE_URL },
      { label: "EMPTY", value: "" },
    ]);
    expect(out).toBe(
      "url=[ANTHROPIC_BASE_URL] token=[ANTHROPIC_AUTH_TOKEN] again [ANTHROPIC_AUTH_TOKEN]",
    );
    expect(out).not.toContain(TOKEN);
  });

  it("treats regex metacharacters literally", () => {
    expect(redactSecrets("a.b+c a.b+c", [{ label: "K", value: "a.b+c" }])).toBe("[K] [K]");
    expect(redactSecrets("axb", [{ label: "K", value: "a.b" }])).toBe("axb");
  });
});

describe("RedactingStreamBuffer", () => {
  const secrets = [
    { label: "ANTHROPIC_AUTH_TOKEN", value: TOKEN },
    { label: "ANTHROPIC_BASE_URL", value: BASE_URL },
  ];
  const line = `{"url":"${BASE_URL}","token":"${TOKEN}"}\nwarn ${TOKEN} end\n`;
  const expected = redactSecrets(line, secrets);

  it("elides a secret whole no matter where the chunk boundary falls", () => {
    for (let i = 0; i <= line.length; i += 1) {
      const buffer = new RedactingStreamBuffer(secrets);
      const out = buffer.push(line.slice(0, i)) + buffer.push(line.slice(i)) + buffer.flush();
      expect(out, `split at ${i}`).toBe(expected);
      expect(out, `split at ${i}`).not.toContain(TOKEN);
      expect(out, `split at ${i}`).not.toContain(BASE_URL);
    }
  });

  it("survives one-byte chunks and a multi-byte UTF-8 split", () => {
    const text = `ok \u00e9\u00e9 ${TOKEN} \u2713\n`;
    const bytes = Buffer.from(text, "utf8");
    const buffer = new RedactingStreamBuffer(secrets);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      out += buffer.push(bytes.subarray(i, i + 1));
    }
    out += buffer.flush();
    expect(out).toBe(redactSecrets(text, secrets));
  });

  it("streams an oversized partial line minus a safe tail, then completes it", () => {
    const head = "a".repeat(70 * 1024);
    const buffer = new RedactingStreamBuffer(secrets);
    const first = buffer.push(`${head}sk-ant-test-t`);
    expect(first.length).toBeGreaterThan(0);
    expect(first).toBe(head.slice(0, first.length));
    const rest = buffer.push("oken+abc/def= tail") + buffer.flush();
    expect(first + rest).toBe(`${head}[ANTHROPIC_AUTH_TOKEN] tail`);
  });

  it("passes text straight through when there are no secrets", () => {
    const buffer = new RedactingStreamBuffer([{ label: "EMPTY", value: "" }]);
    expect(buffer.push("a")).toBe("a");
    expect(buffer.push(Buffer.from("b"))).toBe("b");
    expect(buffer.flush()).toBe("");
  });
});

describe("mergeChildEnv / claudeRedactions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("inherits process.env, overrides win, undefined unsets", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "inherited-key");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://inherited.example");
    const env = mergeChildEnv({
      ANTHROPIC_BASE_URL: BASE_URL,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: TOKEN,
    });
    expect(env.ANTHROPIC_BASE_URL).toBe(BASE_URL);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    expect("ANTHROPIC_API_KEY" in env).toBe(false);
    expect(env.PATH).toBe(process.env.PATH);

    const redactions = claudeRedactions(env);
    expect([...new Set(redactions.map((r) => r.label))]).toEqual([
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_AUTH_TOKEN",
    ]);
    expect(redactions.map((r) => r.value)).toContain(BASE_URL);
    expect(redactions.map((r) => r.value)).toContain(TOKEN);
    expect(CLAUDE_ENV_PASSTHROUGH).toContain("ANTHROPIC_API_KEY");
  });

  it("strips the four nested-session markers for a claude child and nothing else", () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", "sess-1");
    vi.stubEnv("CLAUDE_CODE_CHILD_SESSION", "1");
    vi.stubEnv("CLAUDE_CODE_BRIDGE_SESSION_ID", "bridge-1");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    const env = claudeChildEnv({ ANTHROPIC_AUTH_TOKEN: TOKEN });
    for (const key of CLAUDE_NESTED_SESSION_KEYS) expect(key in env).toBe(false);
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    // cursor-agent keeps the plain merge (the CLI child-env rule is claude's).
    expect(mergeChildEnv().CLAUDECODE).toBe("1");
  });
});

describe("claudeRedactions derived forms", () => {
  const GW = "https://gw.internal.example:4000/anthropic";
  const secrets = claudeRedactions({ ANTHROPIC_BASE_URL: GW, ANTHROPIC_AUTH_TOKEN: TOKEN });

  it("elides the gateway host from connection errors and the normalized URL", () => {
    const probes = [
      "connect ECONNREFUSED gw.internal.example:4000",
      "getaddrinfo ENOTFOUND gw.internal.example",
      `POST ${GW}/v1/messages 401`,
      `base ${GW}/ (trailing slash)`,
      "origin https://gw.internal.example:4000 rejected",
    ];
    for (const probe of probes) {
      const out = redactSecrets(probe, secrets);
      expect(out, probe).not.toContain("gw.internal.example");
      expect(out, probe).toContain("[ANTHROPIC_BASE_URL]");
    }
    // A trailing-slash value is also elided when the child prints it trimmed.
    const slashSecrets = claudeRedactions({ ANTHROPIC_BASE_URL: `${GW}/` });
    expect(redactSecrets(`url=${GW} host`, slashSecrets)).toBe("url=[ANTHROPIC_BASE_URL] host");
  });

  it("elides JSON-escaped, URL-encoded and base64 token forms", () => {
    const probes = [
      `{"authorization":"Bearer ${TOKEN.replaceAll("/", "\\/")}"}`,
      `?key=${encodeURIComponent(TOKEN)}`,
      `Bearer ${Buffer.from(TOKEN).toString("base64")}`,
      `Bearer ${Buffer.from(TOKEN).toString("base64url")}`,
    ];
    for (const probe of probes) {
      const out = redactSecrets(probe, secrets);
      expect(out, probe).toContain("[ANTHROPIC_AUTH_TOKEN]");
      expect(out, probe).not.toContain("sk-ant");
      expect(out, probe).not.toContain(Buffer.from(TOKEN).toString("base64").slice(0, 12));
    }
  });

  it("keeps the derived forms chunk-boundary safe through the stream buffer", () => {
    const line = "warn: getaddrinfo ENOTFOUND gw.internal.example\n";
    for (let i = 0; i <= line.length; i += 1) {
      const buffer = new RedactingStreamBuffer(secrets);
      const out = buffer.push(line.slice(0, i)) + buffer.push(line.slice(i)) + buffer.flush();
      expect(out, `split at ${i}`).toBe("warn: getaddrinfo ENOTFOUND [ANTHROPIC_BASE_URL]\n");
    }
  });

  it("does not derive forms that would mangle unrelated text", () => {
    const local = claudeRedactions({ ANTHROPIC_BASE_URL: "http://localhost:4000" });
    expect(local.map((r) => r.value)).not.toContain("localhost");
    expect(local.map((r) => r.value)).toContain("localhost:4000");
    const short = claudeRedactions({ ANTHROPIC_BASE_URL: "http://lan:4000" });
    expect(short.map((r) => r.value)).not.toContain("lan");
    expect(short.map((r) => r.value)).toContain("lan:4000");
  });
});

describe("claudeRunCaps", () => {
  it("reads opt-in caps and reports invalid values instead of silently uncapping", () => {
    expect(claudeRunCaps({})).toEqual({ caps: {}, invalid: [] });
    expect(
      claudeRunCaps({ [CLAUDE_MAX_TURNS_ENV]: "25", [CLAUDE_MAX_BUDGET_USD_ENV]: "1.5" }),
    ).toEqual({ caps: { maxTurns: 25, maxBudgetUsd: 1.5 }, invalid: [] });
    const bad = claudeRunCaps({
      [CLAUDE_MAX_TURNS_ENV]: "lots",
      [CLAUDE_MAX_BUDGET_USD_ENV]: "-1",
    });
    expect(bad.caps).toEqual({});
    expect(bad.invalid).toHaveLength(2);
    expect(bad.invalid[0]).toContain(CLAUDE_MAX_TURNS_ENV);
    expect(bad.invalid[1]).toContain(CLAUDE_MAX_BUDGET_USD_ENV);
  });
});

describe("checkClaudeVersion", () => {
  beforeEach(() => resetClaudeVersionCache());
  afterEach(() => resetClaudeVersionCache());

  it("parses the CLI banner", () => {
    expect(parseClaudeVersion("2.1.261 (Claude Code)")).toBe("2.1.261");
    expect(parseClaudeVersion("garbage")).toBeNull();
    expect(parseClaudeVersion(null)).toBeNull();
  });

  it("refuses a binary older than the --permission-prompts floor and memoizes", () => {
    const versionFn = vi.fn(() => "2.1.100 (Claude Code)");
    const first = checkClaudeVersion("claude", versionFn);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.message).toContain("2.1.100");
      expect(first.message).toContain(CLAUDE_MIN_VERSION);
      expect(first.message).toContain("claude update");
    }
    checkClaudeVersion("claude", versionFn);
    expect(versionFn).toHaveBeenCalledTimes(1);
  });

  it("accepts the floor and newer, warns without blocking when unreadable", () => {
    expect(checkClaudeVersion("a", () => CLAUDE_MIN_VERSION)).toEqual({
      ok: true,
      version: CLAUDE_MIN_VERSION,
    });
    expect(checkClaudeVersion("b", () => "3.0.0 (Claude Code)").ok).toBe(true);
    const unknown = checkClaudeVersion("c", () => null);
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.warning).toContain(CLAUDE_MIN_VERSION);
  });
});

describe("missingClaudeAdapter", () => {
  it("requires .claude/commands/<name>.md only for a leading-slash prompt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-adapter-"));
    expect(await missingClaudeAdapter(root, "plain prompt with /run-plan later")).toBeNull();
    expect(await missingClaudeAdapter(root, "/run-plan - tick")).toBe(
      path.join(".claude", "commands", "run-plan.md"),
    );
    await mkdir(path.join(root, ".claude", "commands"), { recursive: true });
    await writeFile(path.join(root, ".claude", "commands", "run-plan.md"), "adapter\n", "utf8");
    expect(await missingClaudeAdapter(root, "/run-plan - tick")).toBeNull();
  });
});

describe("claudeHeadlessArgs / claudeTickArgs", () => {
  it("builds print-mode argv from confirmed flags only; the prompt is not positional", () => {
    expect(claudeTickArgs).toBe(claudeHeadlessArgs);
    expect(claudeTickArgs()).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--permission-prompts",
      "none",
      "--input-format",
      "stream-json",
      "--replay-user-messages",
    ]);
    expect(claudeTickArgs({ model: "sonnet" })).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--permission-prompts",
      "none",
      "--input-format",
      "stream-json",
      "--replay-user-messages",
      "--model",
      "sonnet",
    ]);
  });

  it("appends the opt-in caps only when set", () => {
    expect(claudeHeadlessArgs({ maxTurns: 25, maxBudgetUsd: 2 })).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--permission-prompts",
      "none",
      "--input-format",
      "stream-json",
      "--replay-user-messages",
      "--max-turns",
      "25",
      "--max-budget-usd",
      "2",
    ]);
  });
});

describe("cursorAgentHeadlessArgs", () => {
  it("builds positional-prompt argv shared with dispatch", () => {
    expect(
      cursorAgentHeadlessArgs({
        workspace: "/repo",
        prompt: "do work",
        model: "sonnet",
      }),
    ).toEqual([
      "-p",
      "--force",
      "--sandbox",
      "disabled",
      "--output-format",
      "stream-json",
      "--workspace",
      "/repo",
      "--model",
      "sonnet",
      "do work",
    ]);
  });
});

describe("claudeBackend.run", () => {
  beforeEach(() => {
    resetClaudeVersionCache();
    // Pin the terminal renderer to plain mode so the echoed lines are exact
    // whatever stdio the test pool inherits.
    vi.stubEnv("NO_COLOR", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetClaudeVersionCache();
  });

  it("spawns claude -p in the workspace with env passthrough and redacts the log", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", TOKEN);
    vi.stubEnv("CLAUDECODE", "1");
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({
      exitCode: 0,
      stdout: `{"type":"system","bearer":"${TOKEN}","url":"${BASE_URL}"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"bearer ${TOKEN} at ${BASE_URL}"}]}}\n`,
      stderr: `warn: ${TOKEN}\n{"type":"result","result":"LOOP_TICK_RESULT: continue"}\n`,
    });
    const log = vi.fn();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = await claudeBackend.run({
      workspace: "/repo",
      prompt: "tick prompt",
      model: "sonnet",
      logPath,
      env: { ANTHROPIC_BASE_URL: BASE_URL },
      spawnFn: spawnFn as unknown as SpawnFn,
      log,
      versionFn: versionOk,
    });

    expect(result).toEqual({ exitCode: 0, hitl: { replies: [], fallbackDetections: 0 } });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0]?.[0]).toBe("claude");
    expect(spawnFn.mock.calls[0]?.[1]).toEqual(claudeTickArgs({ model: "sonnet" }));
    const spawnOpts = spawnOptsOf(spawnFn);
    expect(spawnOpts.cwd).toBe("/repo");
    // stdin stays open for the relay; the prompt is the first `user` event.
    expect(spawnOpts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(stdinOf(spawnFn).writes).toEqual([
      '{"type":"user","message":{"role":"user","content":"tick prompt"}}\n',
    ]);
    // A LOOP_TICK_RESULT result is not a gate: stdin is ended so the child exits.
    expect(stdinOf(spawnFn).ended).toBe(true);
    expect(spawnOpts.env?.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    expect(spawnOpts.env?.ANTHROPIC_BASE_URL).toBe(BASE_URL);
    expect(spawnOpts.env?.PATH).toBe(process.env.PATH);
    expect(spawnOpts.env && "CLAUDECODE" in spawnOpts.env).toBe(false);

    const logText = await readFile(logPath, "utf8");
    expect(logText).not.toContain(TOKEN);
    expect(logText).not.toContain(BASE_URL);
    expect(logText).toContain('"bearer":"[ANTHROPIC_AUTH_TOKEN]"');
    expect(logText).toContain('"url":"[ANTHROPIC_BASE_URL]"');
    expect(logText).toContain("warn: [ANTHROPIC_AUTH_TOKEN]");
    expect(logText).toContain("LOOP_TICK_RESULT: continue");

    // The terminal gets rendered lines, never the raw NDJSON: the assistant
    // text and the result status appear, the system event and the stderr
    // warning do not, and the secret is elided on that path too.
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    expect(echoed).not.toContain(TOKEN);
    expect(echoed).not.toContain(BASE_URL);
    expect(echoed).toBe(
      "bearer [ANTHROPIC_AUTH_TOKEN] at [ANTHROPIC_BASE_URL]\n✦ result success\n",
    );
    write.mockRestore();

    expect(log).toHaveBeenCalledTimes(1);
    const tip = String(log.mock.calls[0]?.[0]);
    expect(tip).toContain("ANTHROPIC_BASE_URL=set");
    expect(tip).toContain("ANTHROPIC_AUTH_TOKEN=set");
    expect(tip).toContain("ANTHROPIC_API_KEY=unset");
    expect(tip).not.toContain(TOKEN);
    expect(tip).not.toContain(BASE_URL);
    expect(tip).not.toContain("/repo");
  });

  it("redacts a secret split across two stdout chunks", async () => {
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({
      exitCode: 0,
      stdoutChunks: [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"x sk-ant-test-t',
        'oken+abc/def="}]}}\n',
        `{"type":"result","subtype":"success","result":"${TOKEN}"}`,
      ],
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await claudeBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      env: {
        ANTHROPIC_AUTH_TOKEN: TOKEN,
        ANTHROPIC_BASE_URL: undefined,
        ANTHROPIC_API_KEY: undefined,
      },
      spawnFn: spawnFn as unknown as SpawnFn,
      log: () => {},
      versionFn: versionOk,
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();
    const logText = await readFile(logPath, "utf8");
    expect(logText).toBe(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"x [ANTHROPIC_AUTH_TOKEN]"}]}}\n{"type":"result","subtype":"success","result":"[ANTHROPIC_AUTH_TOKEN]"}',
    );
    expect(logText).not.toContain(TOKEN);
    // The unterminated final line is still rendered on stream end.
    expect(echoed).toBe("x [ANTHROPIC_AUTH_TOKEN]\n✦ result success\n");
  });

  it("redacts a gateway host split across two stderr chunks", async () => {
    const logPath = await tmpLog();
    const gw = "https://gw.internal.example:4000/anthropic";
    const spawnFn = mockSpawn({
      exitCode: 1,
      stderrChunks: ["Error: connect ECONNREFUSED gw.inter", "nal.example:4000\n"],
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await claudeBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      env: {
        ANTHROPIC_BASE_URL: gw,
        ANTHROPIC_AUTH_TOKEN: undefined,
        ANTHROPIC_API_KEY: undefined,
      },
      spawnFn: spawnFn as unknown as SpawnFn,
      log: () => {},
      versionFn: versionOk,
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();
    expect(result).toMatchObject({ exitCode: 1 });
    const logText = await readFile(logPath, "utf8");
    expect(logText).toBe("Error: connect ECONNREFUSED [ANTHROPIC_BASE_URL]\n");
    expect(logText).not.toContain("gw.internal.example");
    // A non-JSON stderr line is logged but not rendered.
    expect(echoed).toBe("");
  });

  it("passes the opt-in caps to argv and names them in the tip", async () => {
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({ exitCode: 0 });
    const log = vi.fn();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await claudeBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      env: {
        [CLAUDE_MAX_TURNS_ENV]: "30",
        [CLAUDE_MAX_BUDGET_USD_ENV]: "oops",
        ANTHROPIC_AUTH_TOKEN: undefined,
        ANTHROPIC_BASE_URL: undefined,
        ANTHROPIC_API_KEY: undefined,
      },
      spawnFn: spawnFn as unknown as SpawnFn,
      log,
      versionFn: versionOk,
    });
    write.mockRestore();
    const args = spawnFn.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("30");
    expect(args).not.toContain("--max-budget-usd");
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes(`invalid ${CLAUDE_MAX_BUDGET_USD_ENV}`))).toBe(true);
    expect(lines.some((l) => l.includes("max-turns=30"))).toBe(true);
  });

  it("refuses an older claude before spawning", async () => {
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({ exitCode: 0 });
    await expect(
      claudeBackend.run({
        workspace: "/repo",
        prompt: "tick",
        logPath,
        env: { ANTHROPIC_AUTH_TOKEN: undefined, ANTHROPIC_BASE_URL: undefined },
        spawnFn: spawnFn as unknown as SpawnFn,
        log: () => {},
        versionFn: () => "2.1.200 (Claude Code)",
      }),
    ).rejects.toThrow(/claude 2\.1\.200 is older than 2\.1\.259/);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("fails closed when the slash adapter is missing from the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-backends-ws-"));
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({ exitCode: 0 });
    const run = (prompt: string) =>
      claudeBackend.run({
        workspace: root,
        prompt,
        logPath,
        env: { ANTHROPIC_AUTH_TOKEN: undefined, ANTHROPIC_BASE_URL: undefined },
        spawnFn: spawnFn as unknown as SpawnFn,
        log: () => {},
        versionFn: versionOk,
      });
    await expect(run("/run-plan - single tick")).rejects.toThrow(
      /\.claude\/commands\/run-plan\.md is missing[\s\S]*agent-kit install --claude/,
    );
    expect(spawnFn).not.toHaveBeenCalled();
    await mkdir(path.join(root, ".claude", "commands"), { recursive: true });
    await writeFile(path.join(root, ".claude", "commands", "run-plan.md"), "adapter\n", "utf8");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(run("/run-plan - single tick")).resolves.toMatchObject({ exitCode: 0 });
    write.mockRestore();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("redacts a synchronous spawn throw (no cause)", async () => {
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({ throwSync: new Error(`spawn EACCES cwd=/repo token=${TOKEN}`) });
    await expect(
      claudeBackend.run({
        workspace: "/repo",
        prompt: "tick",
        logPath,
        env: { ANTHROPIC_AUTH_TOKEN: TOKEN },
        spawnFn: spawnFn as unknown as SpawnFn,
        log: () => {},
        versionFn: versionOk,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const message = String(err);
      return (
        message.includes("EACCES") &&
        message.includes("[ANTHROPIC_AUTH_TOKEN]") &&
        !message.includes(TOKEN) &&
        (err as { cause?: unknown }).cause === undefined
      );
    });
  });

  it("redacts ANTHROPIC_API_KEY end to end and reports it present in the tip", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", API_KEY);
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({
      exitCode: 0,
      stdout: `{"type":"system","key":"${API_KEY}"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"key ${API_KEY}"}]}}\n`,
      stderr: `x-api-key: ${API_KEY}\n`,
    });
    const log = vi.fn();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await claudeBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      env: { ANTHROPIC_AUTH_TOKEN: undefined, ANTHROPIC_BASE_URL: undefined },
      spawnFn: spawnFn as unknown as SpawnFn,
      log,
      versionFn: versionOk,
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();

    expect(spawnOptsOf(spawnFn).env?.ANTHROPIC_API_KEY).toBe(API_KEY);
    const logText = await readFile(logPath, "utf8");
    expect(logText).not.toContain(API_KEY);
    expect(logText).toContain('"key":"[ANTHROPIC_API_KEY]"');
    expect(logText).toContain("x-api-key: [ANTHROPIC_API_KEY]");
    expect(echoed).not.toContain(API_KEY);
    expect(echoed).toBe("key [ANTHROPIC_API_KEY]\n");
    const tip = String(log.mock.calls[0]?.[0]);
    expect(tip).toContain("ANTHROPIC_API_KEY=set");
    expect(tip).toContain("ANTHROPIC_AUTH_TOKEN=unset");
    expect(tip).not.toContain(API_KEY);
  });

  it("rejects (redacted) when the log file cannot be opened instead of crashing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-backends-"));
    const logPath = path.join(dir, "no-such-subdir", "tick.log");
    const spawnFn = mockSpawn({ exitCode: 0, stdout: `hello ${TOKEN}\n` });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await expect(
      claudeBackend.run({
        workspace: "/repo",
        prompt: "tick",
        logPath,
        env: { ANTHROPIC_AUTH_TOKEN: TOKEN },
        spawnFn: spawnFn as unknown as SpawnFn,
        log: () => {},
        versionFn: versionOk,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const message = String(err);
      return message.includes("ENOENT") && !message.includes(TOKEN);
    });
    write.mockRestore();
  });

  it("surfaces a non-zero exit code without throwing", async () => {
    const logPath = await tmpLog();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await claudeBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      env: {
        ANTHROPIC_AUTH_TOKEN: undefined,
        ANTHROPIC_BASE_URL: undefined,
        ANTHROPIC_API_KEY: undefined,
      },
      spawnFn: mockSpawn({ exitCode: 1, stderr: "error: unknown option\n" }) as unknown as SpawnFn,
      log: () => {},
      versionFn: versionOk,
    });
    write.mockRestore();
    expect(result).toMatchObject({ exitCode: 1 });
    expect(await readFile(logPath, "utf8")).toContain("error: unknown option");
  });

  it("rejects with a redacted message when spawn fails", async () => {
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({ error: new Error(`spawn claude ENOENT (${TOKEN})`) });
    await expect(
      claudeBackend.run({
        workspace: "/repo",
        prompt: "tick",
        logPath,
        env: { ANTHROPIC_AUTH_TOKEN: TOKEN },
        spawnFn: spawnFn as unknown as SpawnFn,
        log: () => {},
        versionFn: versionOk,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const message = String(err);
      const cause = (err as { cause?: unknown }).cause;
      return (
        message.includes("claude backend failed to start") &&
        message.includes("ENOENT") &&
        message.includes("[ANTHROPIC_AUTH_TOKEN]") &&
        !message.includes(TOKEN) &&
        cause === undefined
      );
    });
  });
});

describe("spawnLogged compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the 3-arg form: no cwd/env keys, no redaction", async () => {
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({ exitCode: 3, stdout: "plain\n" });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await spawnLogged("cursor-agent", ["-p"], logPath, {
      spawnFn: spawnFn as unknown as SpawnFn,
    });
    write.mockRestore();
    expect(result).toEqual({ exitCode: 3 });
    const opts = spawnFn.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opts).toEqual({ stdio: ["ignore", "pipe", "pipe"] });
    expect(await readFile(logPath, "utf8")).toBe("plain\n");
  });

  it("cursor-agent argv is unchanged and workspace-scoped", async () => {
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({ exitCode: 0 });
    await cursorAgentBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      spawnFn: spawnFn as unknown as SpawnFn,
    });
    expect(spawnFn).toHaveBeenCalledWith(
      "cursor-agent",
      [
        "-p",
        "--force",
        "--sandbox",
        "disabled",
        "--output-format",
        "stream-json",
        "--workspace",
        "/repo",
        "tick",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });
});

describe("cursorAgentBackend.run", () => {
  beforeEach(() => vi.stubEnv("NO_COLOR", "1"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redacts an ANTHROPIC token inherited from process.env in the tick log and echo", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", TOKEN);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({
      exitCode: 0,
      stdoutChunks: [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"bearer sk-ant-test-t',
        `oken+abc/def="}]}}\n`,
      ],
      stderr: `warn: ${TOKEN}\n`,
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await cursorAgentBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      spawnFn: spawnFn as unknown as SpawnFn,
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();

    expect(result).toMatchObject({ exitCode: 0 });
    // No env override: the child still inherits process.env untouched.
    expect(spawnFn.mock.calls[0]?.[2]).toEqual({ stdio: ["ignore", "pipe", "pipe"] });
    const logText = await readFile(logPath, "utf8");
    expect(logText).not.toContain(TOKEN);
    expect(logText).toBe(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"bearer [ANTHROPIC_AUTH_TOKEN]"}]}}\nwarn: [ANTHROPIC_AUTH_TOKEN]\n',
    );
    expect(echoed).not.toContain(TOKEN);
    expect(echoed).toBe("bearer [ANTHROPIC_AUTH_TOKEN]\n");
  });

  it("redacts a value supplied through the env override and still passes it to the child", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const logPath = await tmpLog();
    const spawnFn = mockSpawn({
      exitCode: 0,
      stdout: `{"type":"assistant","message":{"content":[{"type":"text","text":"x-api-key: ${API_KEY}"}]}}\n`,
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await cursorAgentBackend.run({
      workspace: "/repo",
      prompt: "tick",
      logPath,
      env: { ANTHROPIC_API_KEY: API_KEY },
      spawnFn: spawnFn as unknown as SpawnFn,
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();

    expect(spawnOptsOf(spawnFn).env?.ANTHROPIC_API_KEY).toBe(API_KEY);
    const logText = await readFile(logPath, "utf8");
    expect(logText).toBe(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"x-api-key: [ANTHROPIC_API_KEY]"}]}}\n',
    );
    expect(echoed).toBe("x-api-key: [ANTHROPIC_API_KEY]\n");
  });
});
