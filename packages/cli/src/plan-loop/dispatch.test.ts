import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeHeadlessArgs,
  cursorAgentHeadlessArgs,
  resetClaudeVersionCache,
} from "./backends.js";
import {
  RUN_CATALOG,
  RUN_PROMOTE_BLOCKED,
  buildDispatchPrompt,
  classifySlash,
  claudeDispatchArgs,
  cursorAgentDispatchArgs,
  normalizeSlashName,
  promoteBlockedMessage,
  readCommandFile,
  rewriteRootArgvToRun,
  runHeadlessDispatch,
  unknownSlashMessage,
} from "./dispatch.js";
import { RESERVED_GATE_IDS } from "./hitl-relay.js";

type SpawnFn = typeof spawn;

function mockSpawn(input: {
  exitCode?: number;
  stdoutChunks?: string[];
  stderrChunks?: string[];
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
    const writes: string[] = [];
    ee.stdin = Object.assign(new EventEmitter(), {
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
    ee.kill = () => true;
    queueMicrotask(() => {
      for (const chunk of input.stdoutChunks ?? []) ee.stdout.emit("data", Buffer.from(chunk));
      for (const chunk of input.stderrChunks ?? []) ee.stderr.emit("data", Buffer.from(chunk));
      ee.emit("close", input.exitCode ?? 0);
    });
    return ee as unknown as ReturnType<SpawnFn>;
  });
}

const versionOk = () => "2.1.261 (Claude Code)";

describe("slash catalog", () => {
  it("normalizes leading slash and .md", () => {
    expect(normalizeSlashName("/backlog-add.md")).toBe("backlog-add");
    expect(normalizeSlashName("continue-plan")).toBe("continue-plan");
  });

  it("maps the project-run set and omits promote slashes", () => {
    expect(classifySlash("run-plan")).toBe("run-plan");
    expect(classifySlash("/run-plan-all")).toBe("catalog");
    expect(classifySlash("git-staging")).toBe("catalog");
    expect(classifySlash("kit-staging")).toBe("unknown");
    expect(classifySlash("git-prod")).toBe("promote-blocked");
    expect(classifySlash("/kit-prod.md")).toBe("promote-blocked");
    expect(classifySlash("hotfix")).toBe("unknown");
    expect(RUN_CATALOG).not.toContain("git-prod");
    expect(RUN_CATALOG).not.toContain("kit-staging");
    expect(RUN_PROMOTE_BLOCKED).toBe(RESERVED_GATE_IDS);
    expect(RUN_PROMOTE_BLOCKED).toEqual(["git-prod", "kit-prod"]);
  });

  it("refuses promote with an operator-gated message", () => {
    const msg = promoteBlockedMessage("git-prod");
    expect(msg).toContain("operator-gated");
    expect(msg).toContain("/git-prod");
    expect(msg).toContain("Never auto /git-prod");
    expect(unknownSlashMessage("hotfix")).toContain("Catalog:");
  });
});

describe("rewriteRootArgvToRun", () => {
  it("keeps first-class citty names and strips a leading slash", () => {
    expect(rewriteRootArgvToRun(["run-plan-all"])).toEqual(["run-plan-all"]);
    expect(rewriteRootArgvToRun(["/run-plan-all"])).toEqual(["run-plan-all"]);
    expect(rewriteRootArgvToRun(["/run-plan-all", "--dry-run"])).toEqual([
      "run-plan-all",
      "--dry-run",
    ]);
    expect(rewriteRootArgvToRun(["run-plan"])).toEqual(["run-plan"]);
    expect(rewriteRootArgvToRun(["/run-plan", "--backend", "claude"])).toEqual([
      "run-plan",
      "--backend",
      "claude",
    ]);
  });

  it("maps other catalog slashes onto agent-kit run and leaves run <slash> alone", () => {
    expect(rewriteRootArgvToRun(["run", "run-plan-all"])).toEqual(["run", "run-plan-all"]);
    expect(rewriteRootArgvToRun(["/continue-plan"])).toEqual(["run", "continue-plan"]);
    expect(rewriteRootArgvToRun(["backlog-add", "--dry-run"])).toEqual([
      "run",
      "backlog-add",
      "--dry-run",
    ]);
  });

  it("rewrites promote-blocked slashes onto run so executeRun can refuse", () => {
    expect(rewriteRootArgvToRun(["/git-prod"])).toEqual(["run", "git-prod"]);
    expect(rewriteRootArgvToRun(["kit-prod"])).toEqual(["run", "kit-prod"]);
  });

  it("leaves unknown tokens and flag-only argv unchanged", () => {
    expect(rewriteRootArgvToRun(["status"])).toEqual(["status"]);
    expect(rewriteRootArgvToRun(["hotfix"])).toEqual(["hotfix"]);
    expect(rewriteRootArgvToRun(["--help"])).toEqual(["--help"]);
    expect(rewriteRootArgvToRun([])).toEqual([]);
  });
});

describe("dispatch prompt and spawn args", () => {
  it("wraps L0 body without forking HITL into a second dialect", () => {
    const prompt = buildDispatchPrompt("# /backlog-add\n\nWrite the plan.\n");
    expect(prompt).toContain("numbered-list HITL");
    expect(prompt).toContain("Never /git-prod");
    expect(prompt).toContain("# /backlog-add");
    expect(prompt).toContain("Write the plan.");
  });

  it("reuses the run-plan cursor-agent flag shape", () => {
    const args = cursorAgentDispatchArgs({
      workspace: "/repo",
      prompt: "do work",
      model: "sonnet",
    });
    expect(args).toEqual(
      cursorAgentHeadlessArgs({
        workspace: "/repo",
        prompt: "do work",
        model: "sonnet",
      }),
    );
    expect(args).toEqual([
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

  it("uses the same headless claude -p argv as the tick loop (permissions bypassed, prompt on stdin)", () => {
    const args = claudeDispatchArgs();
    expect(args).toEqual(claudeHeadlessArgs());
    expect(args).toEqual([
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
    expect(claudeDispatchArgs({ model: "sonnet", maxTurns: 5 })).toEqual(
      claudeHeadlessArgs({ model: "sonnet", maxTurns: 5 }),
    );
  });
});

describe("runHeadlessDispatch on claude", () => {
  const TOKEN = "sk-ant-test-token+abc/def=";
  const BASE_URL = "https://gateway.example/anthropic";
  const API_KEY = "anthropic-test-api-key-0123456789";

  beforeEach(() => {
    resetClaudeVersionCache();
    // Plain-mode terminal renderer: exact echoed lines regardless of pool stdio.
    vi.stubEnv("NO_COLOR", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetClaudeVersionCache();
  });

  it("spawns in the workspace, passes env through and redacts the run log", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", TOKEN);
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_SESSION_ID", "sess");
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-dispatch-"));
    const logPath = path.join(dir, "run.log");
    const spawnFn = mockSpawn({
      exitCode: 0,
      stdoutChunks: [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"auth sk-ant-test-t',
        'oken+abc/def="}]}}\n',
      ],
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await runHeadlessDispatch({
      backendId: "claude",
      bin: "/usr/bin/claude",
      workspace: "/repo",
      prompt: "follow L0",
      logPath,
      spawnFn: spawnFn as unknown as SpawnFn,
      versionFn: versionOk,
      log: () => {},
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();

    expect(result).toMatchObject({ exitCode: 0 });
    expect(spawnFn.mock.calls[0]?.[0]).toBe("/usr/bin/claude");
    expect(spawnFn.mock.calls[0]?.[1]).toEqual(claudeHeadlessArgs());
    expect(spawnFn.mock.calls[0]?.[1]).toContain("--dangerously-skip-permissions");
    const opts = spawnFn.mock.calls[0]?.[2] as {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdio?: unknown;
    };
    expect(opts.cwd).toBe("/repo");
    expect(opts.stdio).toEqual(["pipe", "pipe", "pipe"]);
    const child = spawnFn.mock.results[0]?.value as { stdin: { writes: string[] } };
    expect(child.stdin.writes).toEqual([
      '{"type":"user","message":{"role":"user","content":"follow L0"}}\n',
    ]);
    expect(opts.env?.ANTHROPIC_AUTH_TOKEN).toBe(TOKEN);
    expect(opts.env && "CLAUDECODE" in opts.env).toBe(false);
    expect(opts.env && "CLAUDE_CODE_SESSION_ID" in opts.env).toBe(false);
    const logText = await readFile(logPath, "utf8");
    expect(logText).toBe(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"auth [ANTHROPIC_AUTH_TOKEN]"}]}}\n',
    );
    // The terminal shows the rendered assistant text, redacted, never raw NDJSON.
    expect(echoed).toBe("auth [ANTHROPIC_AUTH_TOKEN]\n");
  });

  it("redacts ANTHROPIC_BASE_URL (and its host) and ANTHROPIC_API_KEY in the run log", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", BASE_URL);
    vi.stubEnv("ANTHROPIC_API_KEY", API_KEY);
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-dispatch-"));
    const logPath = path.join(dir, "run.log");
    const spawnFn = mockSpawn({
      exitCode: 0,
      stdoutChunks: [
        `{"url":"${BASE_URL}","key":"${API_KEY}"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"url ${BASE_URL} key ${API_KEY}"}]}}\n`,
      ],
      stderrChunks: ["getaddrinfo ENOTFOUND gateway.example\n"],
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runHeadlessDispatch({
      backendId: "claude",
      bin: "/usr/bin/claude",
      workspace: "/repo",
      prompt: "follow L0",
      logPath,
      spawnFn: spawnFn as unknown as SpawnFn,
      versionFn: versionOk,
      log: () => {},
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();
    const opts = spawnFn.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    expect(opts.env?.ANTHROPIC_BASE_URL).toBe(BASE_URL);
    expect(opts.env?.ANTHROPIC_API_KEY).toBe(API_KEY);
    const logText = await readFile(logPath, "utf8");
    expect(logText).toBe(
      '{"url":"[ANTHROPIC_BASE_URL]","key":"[ANTHROPIC_API_KEY]"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"url [ANTHROPIC_BASE_URL] key [ANTHROPIC_API_KEY]"}]}}\ngetaddrinfo ENOTFOUND [ANTHROPIC_BASE_URL]\n',
    );
    expect(logText).not.toContain("gateway.example");
    expect(echoed).not.toContain("gateway.example");
    expect(echoed).toBe("url [ANTHROPIC_BASE_URL] key [ANTHROPIC_API_KEY]\n");
  });

  it("refuses an older claude and reports a synchronous spawn throw redacted", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", TOKEN);
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-dispatch-"));
    const logPath = path.join(dir, "run.log");
    const old = mockSpawn({ exitCode: 0 });
    await expect(
      runHeadlessDispatch({
        backendId: "claude",
        bin: "/usr/bin/claude",
        workspace: "/repo",
        prompt: "follow L0",
        logPath,
        spawnFn: old as unknown as SpawnFn,
        versionFn: () => "2.1.100 (Claude Code)",
        log: () => {},
      }),
    ).rejects.toThrow(/claude dispatch: claude 2\.1\.100 is older than 2\.1\.259/);
    expect(old).not.toHaveBeenCalled();

    resetClaudeVersionCache();
    const thrower = mockSpawn({ throwSync: new Error(`spawn EACCES ${TOKEN}`) });
    await expect(
      runHeadlessDispatch({
        backendId: "claude",
        bin: "/usr/bin/claude",
        workspace: "/repo",
        prompt: "follow L0",
        logPath,
        spawnFn: thrower as unknown as SpawnFn,
        versionFn: versionOk,
        log: () => {},
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const message = String(err);
      return (
        message.includes("claude dispatch failed to start") &&
        message.includes("EACCES") &&
        message.includes("[ANTHROPIC_AUTH_TOKEN]") &&
        !message.includes(TOKEN) &&
        (err as { cause?: unknown }).cause === undefined
      );
    });
  });

  it("keeps cursor-agent dispatch with no cwd/env and redacts an inherited ANTHROPIC token", async () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", TOKEN);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-dispatch-"));
    const logPath = path.join(dir, "run.log");
    const spawnFn = mockSpawn({
      exitCode: 2,
      stdoutChunks: [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"env sk-ant-test-t',
        'oken+abc/def="}]}}\n',
      ],
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const result = await runHeadlessDispatch({
      backendId: "cursor-agent",
      bin: "cursor-agent",
      workspace: "/repo",
      prompt: "follow L0",
      logPath,
      spawnFn: spawnFn as unknown as SpawnFn,
    });
    const echoed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();
    expect(result).toMatchObject({ exitCode: 2 });
    // The child still inherits process.env untouched: no cwd, no env override.
    expect(spawnFn.mock.calls[0]?.[2]).toEqual({ stdio: ["ignore", "pipe", "pipe"] });
    const logText = await readFile(logPath, "utf8");
    expect(logText).not.toContain(TOKEN);
    expect(logText).toBe(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"env [ANTHROPIC_AUTH_TOKEN]"}]}}\n',
    );
    expect(echoed).toBe("env [ANTHROPIC_AUTH_TOKEN]\n");
  });
});

describe("readCommandFile", () => {
  it("reads .cursor/commands/<slash>.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-run-"));
    const dir = path.join(root, ".cursor", "commands");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "backlog-add.md"), "# backlog-add\n", "utf8");
    const found = await readCommandFile(root, "/backlog-add");
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.body).toContain("# backlog-add");
    }
    const missing = await readCommandFile(root, "continue-plan");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.message).toContain("Command file not found");
    }
  });
});
