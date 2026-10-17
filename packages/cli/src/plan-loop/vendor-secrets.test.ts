import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeBackend,
  claudeRedactions,
  cursorAgentBackend,
  FORGE_SECRET_ENV,
  RedactingStreamBuffer,
  resetClaudeVersionCache,
  VENDOR_SECRET_ENV,
} from "./backends.js";
import { runHeadlessDispatch } from "./dispatch.js";
import { createDriverEmitter, DriverAgentSink } from "./driver-events.js";

type SpawnFn = typeof spawn;

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Seeded secrets: `+ / =` so the URL-encoded and base64 forms differ from the
 * raw value. Built at runtime (no key = "literal" pair in the source, which
 * secret scanners rightly flag).
 */
const SEEDED_KEYS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CURSOR_API_KEY",
  "CURSOR_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
  "GLAB_TOKEN",
] as const;
const SEEDED: Record<string, string> = Object.fromEntries(
  SEEDED_KEYS.map((key, i) => [key, ["seeded", key.toLowerCase(), `v+${i}/x=`].join("-")]),
);

function forms(value: string): string[] {
  return [
    value,
    Buffer.from(value).toString("base64"),
    encodeURIComponent(value),
    value.replaceAll("/", "\\/"),
  ];
}

function fakeSpawn(script: string): SpawnFn {
  return ((_cmd: string, args: string[], opts: Parameters<SpawnFn>[2]) =>
    spawn(process.execPath, [script, ...args], opts)) as unknown as SpawnFn;
}

function expectNoLeak(text: string, where: string) {
  for (const [key, value] of Object.entries(SEEDED)) {
    for (const form of forms(value)) {
      expect(text.includes(form), `${key} (${form}) leaked into ${where}`).toBe(false);
    }
  }
}

describe("vendor secret redaction (seeded environment)", () => {
  beforeEach(() => resetClaudeVersionCache());
  afterEach(() => vi.unstubAllEnvs());

  it("covers the forge tokens with the same derived forms as the vendor keys", () => {
    for (const key of FORGE_SECRET_ENV) {
      const entries = claudeRedactions({ [key]: SEEDED[key] }).filter((r) => r.label === key);
      const values = new Set(entries.map((r) => r.value));
      for (const form of forms(SEEDED[key] as string)) expect(values.has(form)).toBe(true);
    }
  });

  it("the line buffer elides a forge token split across two chunks", () => {
    const value = SEEDED.GH_TOKEN as string;
    const buffer = new RedactingStreamBuffer(claudeRedactions({ GH_TOKEN: value }));
    const half = Math.floor(value.length / 2);
    const out =
      buffer.push(`token ${value.slice(0, half)}`) + buffer.push(`${value.slice(half)} end\n`);
    expect(out + buffer.flush()).toBe("token [GH_TOKEN] end\n");
  });

  it("claude dispatch: no seeded secret reaches the run log or the terminal side", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-secrets-run-"));
    const logPath = path.join(dir, "run-1.log");
    for (const [key, value] of Object.entries(SEEDED)) vi.stubEnv(key, value);
    vi.stubEnv("FAKE_CLAUDE_MODE", "echo-env");
    const rendered: string[] = [];
    const result = await runHeadlessDispatch({
      backendId: "claude",
      bin: "claude",
      workspace: dir,
      prompt: "say the env",
      logPath,
      spawnFn: fakeSpawn(path.join(FIXTURES, "fake-claude.mjs")),
      versionFn: () => "2.1.278 (Claude Code)",
      log: (line) => rendered.push(line),
      render: { feed: (text) => rendered.push(String(text)), end: () => undefined },
      hitl: { policy: "off" },
    });
    expect(result.exitCode).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("[GH_TOKEN]");
    expect(log).toContain("[GLAB_TOKEN]");
    expectNoLeak(log, "the run log");
    expectNoLeak(rendered.join(""), "the terminal side");
  });

  it("covers the Claude subscription token and the Cursor / OpenAI / Codex keys", () => {
    for (const key of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CURSOR_API_KEY",
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
    ]) {
      expect(VENDOR_SECRET_ENV).toContain(key);
    }
    const labels = new Set(claudeRedactions(SEEDED).map((r) => r.label));
    for (const key of Object.keys(SEEDED)) expect(labels.has(key)).toBe(true);
  });

  for (const [name, backend, script, modeKey] of [
    ["claude", claudeBackend, "fake-claude.mjs", "FAKE_CLAUDE_MODE"],
    ["cursor-agent", cursorAgentBackend, "fake-cursor-agent.mjs", "FAKE_CURSOR_AGENT_MODE"],
  ] as const) {
    it(`${name}: no seeded secret reaches the tick log, the terminal render or driver events`, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-secrets-"));
      const logPath = path.join(dir, "tick.log");
      const rendered: string[] = [];
      const driver: string[] = [];
      const sink = new DriverAgentSink(
        createDriverEmitter((t) => driver.push(t)),
        1,
      );
      const result = await backend.run({
        workspace: dir,
        prompt: "say the env",
        logPath,
        spawnFn: fakeSpawn(path.join(FIXTURES, script)),
        versionFn: () => "2.1.278 (Claude Code)",
        env: { ...SEEDED, [modeKey]: "echo-env" },
        log: (line) => rendered.push(line),
        render: {
          feed: (text) => {
            rendered.push(String(text));
            sink.feed(text);
          },
          end: () => sink.end(),
        },
        hitl: { policy: "off" },
      });
      expect(result.exitCode).toBe(0);
      const log = await readFile(logPath, "utf8");
      // The fake did print them: the redaction labels are in the log.
      expect(log).toContain("[OPENAI_API_KEY]");
      expect(log).toContain("[CLAUDE_CODE_OAUTH_TOKEN]");
      expect(log).toContain("[GITHUB_TOKEN]");
      expect(log).toContain("[GITLAB_TOKEN]");
      expectNoLeak(log, "the tick log");
      expectNoLeak(rendered.join(""), "the terminal side");
      expectNoLeak(driver.join(""), "driver events");
    });
  }
});
