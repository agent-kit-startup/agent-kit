import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeProjectSlug } from "../../../../dashboard/lib/chat-sessions.mjs";
import { renderChatSessions, sessionsCommand } from "./sessions.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function seed(workspace: string): string {
  const home = mkdtempSync(join(tmpdir(), "ak-sessions-cli-home-"));
  const dir = join(home, ".claude", "projects", claudeProjectSlug(workspace));
  mkdirSync(join(dir, ID_A, "subagents"), { recursive: true });
  writeFileSync(
    join(dir, `${ID_A}.jsonl`),
    `${JSON.stringify({ type: "user", message: { content: "first prompt" } })}\n${JSON.stringify({ type: "custom-title", customTitle: "release prep" })}\n`,
  );
  writeFileSync(join(dir, ID_A, "subagents", `${ID_B}.jsonl`), "{}\n");
  utimesSync(join(dir, `${ID_A}.jsonl`), 1_700_000_000, 1_700_000_000);
  return home;
}

async function runCommand(args: Record<string, unknown>): Promise<string> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  try {
    // biome-ignore lint/suspicious/noExplicitAny: citty run context is not needed beyond args
    await (sessionsCommand.run as any)({ args: { json: false, ...args } });
  } finally {
    spy.mockRestore();
  }
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agent-kit sessions", () => {
  it("--json prints {withheld, vendors[]} with the shared envelope and session fields", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "ak-sessions-ws-"));
    vi.stubEnv("HOME", seed(workspace));
    const parsed = JSON.parse(await runCommand({ json: true, cwd: workspace }));
    expect(Object.keys(parsed).sort()).toEqual(["vendors", "withheld"]);
    expect(parsed.withheld).toBe(false);
    expect(
      parsed.vendors.map((v: { vendor: string; status: string }) => [v.vendor, v.status]),
    ).toEqual([
      ["claude", "ok"],
      ["codex", "unsupported"],
      ["cursor", "unsupported"],
    ]);
    const claude = parsed.vendors[0];
    expect(Object.keys(claude).sort()).toEqual(
      ["projectDir", "sessions", "status", "total", "vendor"].sort(),
    );
    expect(claude.total).toBe(1);
    expect(claude.sessions).toEqual([
      {
        id: ID_A,
        title: "release prep",
        titleSource: "custom",
        modified: 1_700_000_000_000,
        sizeBytes: expect.any(Number),
      },
    ]);
  });

  it("prints a table with title, age, short id and the resume command", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "ak-sessions-ws-"));
    vi.stubEnv("HOME", seed(workspace));
    const text = await runCommand({ cwd: workspace });
    expect(text).toContain(`Claude Code chats for ${workspace} (1 saved)`);
    expect(text).toMatch(
      /release prep\s+\d+d ago\s+11111111\s+claude --resume 11111111-1111-4111-8111-111111111111/,
    );
    expect(text).toContain("Codex: not supported yet · Cursor: not supported yet");
  });

  it("says the agent CLI saves sessions per folder when there are none", () => {
    const text = renderChatSessions(
      {
        withheld: false,
        vendors: [{ vendor: "claude", status: "none", projectDir: null, sessions: [], total: 0 }],
      },
      { workspace: "/w" },
    );
    expect(text).toContain("No saved Claude Code chats for /w.");
    expect(text).toContain("saves sessions per folder");
  });

  it("adds a cd hint when listing another folder, and caps the count line", () => {
    const now = 1_700_000_000_000;
    const text = renderChatSessions(
      {
        withheld: false,
        vendors: [
          {
            vendor: "claude",
            status: "ok",
            projectDir: "/h/.claude/projects/-other-dir",
            sessions: [
              { id: ID_B, title: null, titleSource: "none", modified: now - 60_000, sizeBytes: 3 },
            ],
            total: 250,
          },
        ],
      },
      { workspace: "/other dir", cwd: "/here", now },
    );
    expect(text).toContain("(1 newest of 250)");
    expect(text).toContain("(untitled)");
    expect(text).toContain("1m ago");
    expect(text).toContain("Resume from that folder: cd '/other dir' first.");
  });

  it("strips terminal escape sequences from titles before printing", () => {
    const text = renderChatSessions(
      {
        withheld: false,
        vendors: [
          {
            vendor: "claude",
            status: "ok",
            projectDir: "/p",
            sessions: [
              {
                id: ID_A,
                title: "\u001b]0;pwned\u0007\u001b[2Jtitle",
                titleSource: "custom",
                modified: 0,
                sizeBytes: 1,
              },
            ],
            total: 1,
          },
        ],
      },
      { workspace: "/p", now: 0 },
    );
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });
});
