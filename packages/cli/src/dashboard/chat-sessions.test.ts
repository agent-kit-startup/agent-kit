// Saved agent chats reader (dashboard/lib/chat-sessions.mjs): the one implementation behind
// `agent-kit sessions` and the Mission Control Chats card. Contract shared with Colony.
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_FULL_SCAN_MAX_BYTES,
  CHAT_SESSIONS_CAP,
  CHAT_TITLE_MAX,
  claudeProjectDir,
  claudeProjectSlug,
  claudeResumeCommand,
  cleanChatTitle,
  collectChats,
  formatChatAge,
  listChatSessions,
  listClaudeSessions,
  readChatTitle,
  shellQuote,
  withholdChats,
  withholdChatsFromPayload,
} from "../../../../dashboard/lib/chat-sessions.mjs";

const WORKSPACE = "/work/demo.app";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Fake HOME with ~/.claude/projects/<slug of WORKSPACE>/ created; returns {home, dir}. */
function fakeStore(workspace = WORKSPACE): { home: string; dir: string } {
  const home = mkdtempSync(join(tmpdir(), "ak-chats-home-"));
  const dir = join(home, ".claude", "projects", claudeProjectSlug(workspace));
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

function jsonl(records: unknown[]): string {
  return `${records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n")}\n`;
}

function user(content: unknown, extra: Record<string, unknown> = {}) {
  return { type: "user", message: { role: "user", content }, ...extra };
}

function writeSession(dir: string, id: string, records: unknown[], mtimeSec?: number): string {
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(path, jsonl(records));
  if (mtimeSec !== undefined) utimesSync(path, mtimeSec, mtimeSec);
  return path;
}

describe("chat-sessions: project slug", () => {
  it("replaces every non-alphanumeric character with '-' (a .cursor segment becomes --cursor)", () => {
    expect(claudeProjectSlug("/home/severina/agent-kit-dev")).toBe("-home-severina-agent-kit-dev");
    expect(claudeProjectSlug("/home/severina/agent-kit-dev/.cursor/memory/decisions")).toBe(
      "-home-severina-agent-kit-dev--cursor-memory-decisions",
    );
    expect(claudeProjectSlug("/home/me/.local/share/x")).toBe("-home-me--local-share-x");
    // Claude Code's own rule is [^a-zA-Z0-9] -> "-", not only "/" and ".".
    expect(claudeProjectSlug("/srv/my_app v2@x")).toBe("-srv-my-app-v2-x");
  });

  it("cuts names over 200 characters and appends the base-36 hash suffix", () => {
    const long = `/${"a".repeat(250)}`;
    const slug = claudeProjectSlug(long);
    expect(slug.startsWith(`-${"a".repeat(199)}-`)).toBe(true);
    expect(slug.length).toBeGreaterThan(201);
    expect(slug).toMatch(/^-a{199}-[0-9a-z]+$/);
    // Deterministic (same input, same folder).
    expect(claudeProjectSlug(long)).toBe(slug);
    expect(claudeProjectSlug(`/${"a".repeat(198)}`)).toBe(`-${"a".repeat(198)}`);
  });

  it("returns no project folder without a usable HOME", () => {
    expect(claudeProjectDir(WORKSPACE, { home: "" })).toBeNull();
    expect(claudeProjectDir(WORKSPACE, { home: null })).toBeNull();
    expect(claudeProjectDir(WORKSPACE, { home: "relative/home" })).toBeNull();
    expect(claudeProjectDir(WORKSPACE, { home: "/h" })).toBe("/h/.claude/projects/-work-demo-app");
  });
});

describe("chat-sessions: title precedence", () => {
  it("prefers the last custom title over the last ai title over the first prompt", () => {
    const { dir } = fakeStore();
    const path = writeSession(dir, uuid(1), [
      user("first typed prompt"),
      { type: "ai-title", aiTitle: "Old AI title" },
      { type: "custom-title", customTitle: "first name" },
      { type: "ai-title", aiTitle: "New AI title" },
      { type: "custom-title", customTitle: "renamed" },
    ]);
    expect(readChatTitle(path)).toEqual({ title: "renamed", titleSource: "custom" });
  });

  it("uses the last ai title when no custom title exists", () => {
    const { dir } = fakeStore();
    const path = writeSession(dir, uuid(2), [
      user("first typed prompt"),
      { type: "ai-title", aiTitle: "Old AI title" },
      { type: "ai-title", aiTitle: "New AI title" },
    ]);
    expect(readChatTitle(path)).toEqual({ title: "New AI title", titleSource: "ai" });
  });

  it("falls back to the first typed prompt, skipping meta, commands and tool results", () => {
    const { dir } = fakeStore();
    const path = writeSession(dir, uuid(3), [
      { type: "mode", mode: "normal" },
      user("<local-command-caveat>Caveat: ignore</local-command-caveat>", { isMeta: true }),
      user("<command-name>/clear</command-name>\n<command-message>clear</command-message>"),
      user("<local-command-stdout>done</local-command-stdout>"),
      user("expanded skill body", { isMeta: true }),
      user([{ type: "tool_result", tool_use_id: "t1", content: "tool output" }]),
      user([
        { type: "image", source: {} },
        { type: "text", text: "  fix the\n\nlogin   bug  " },
      ]),
      user("second prompt"),
    ]);
    expect(readChatTitle(path)).toEqual({
      title: "fix the login bug",
      titleSource: "first-prompt",
    });
  });

  it("cuts a long first prompt to ~80 characters with an ellipsis", () => {
    const { dir } = fakeStore();
    const path = writeSession(dir, uuid(4), [user("word ".repeat(60))]);
    const t = readChatTitle(path);
    expect(t.titleSource).toBe("first-prompt");
    expect([...(t.title ?? "")].length).toBeLessThanOrEqual(CHAT_TITLE_MAX);
    expect(t.title?.endsWith("…")).toBe(true);
  });

  it("keeps a custom title longer than the first-prompt cut (bounded at 200)", () => {
    const { dir } = fakeStore();
    const name = `release ${"x".repeat(90)}`;
    const path = writeSession(dir, uuid(10), [{ type: "custom-title", customTitle: name }]);
    expect(readChatTitle(path)).toEqual({ title: name, titleSource: "custom" });
    const huge = writeSession(dir, uuid(11), [{ type: "ai-title", aiTitle: "y".repeat(500) }]);
    expect([...(readChatTitle(huge).title ?? "")].length).toBe(200);
  });

  it("reports none when nothing names the session", () => {
    const { dir } = fakeStore();
    const path = writeSession(dir, uuid(5), [
      { type: "mode", mode: "normal" },
      user("<command-name>/model</command-name>"),
    ]);
    expect(readChatTitle(path)).toEqual({ title: null, titleSource: "none" });
    expect(readChatTitle(join(dir, "missing.jsonl"))).toEqual({ title: null, titleSource: "none" });
  });

  it("ignores marker text quoted inside other records (only top-level type counts)", () => {
    const { dir } = fakeStore();
    const path = writeSession(dir, uuid(6), [
      user("real prompt"),
      {
        type: "assistant",
        message: { content: [{ type: "text", text: '{"type":"custom-title","customTitle":"x"}' }] },
      },
    ]);
    expect(readChatTitle(path)).toEqual({ title: "real prompt", titleSource: "first-prompt" });
  });

  it("strips control characters and escape sequences from titles", () => {
    expect(cleanChatTitle("\u001b[31mred\u001b[0m\u202eevil\nline")).toBe("[31mred [0m evil line");
    expect(cleanChatTitle("   ")).toBe("");
  });
});

describe("chat-sessions: malformed and huge transcripts", () => {
  it("skips malformed lines and keeps reading", () => {
    const { dir } = fakeStore();
    const path = writeSession(dir, uuid(7), [
      '{"type":"ai-title","aiTitle":',
      "not json at all",
      '{"type":"user","message":',
      user("survivor prompt"),
      "[1,2,3]",
      { type: "ai-title", aiTitle: 42 },
      '{"type":"custom-title"',
    ]);
    expect(readChatTitle(path)).toEqual({ title: "survivor prompt", titleSource: "first-prompt" });
  });

  it("reads a record without a trailing newline", () => {
    const { dir } = fakeStore();
    const path = join(dir, `${uuid(8)}.jsonl`);
    writeFileSync(
      path,
      `${JSON.stringify(user("p"))}\n${JSON.stringify({ type: "ai-title", aiTitle: "tail" })}`,
    );
    expect(readChatTitle(path)).toEqual({ title: "tail", titleSource: "ai" });
  });

  it("reads only the head and tail of a transcript above the full-scan limit", () => {
    const { dir } = fakeStore();
    const path = join(dir, `${uuid(9)}.jsonl`);
    const fd = openSync(path, "w");
    try {
      writeSync(fd, jsonl([user("head prompt")]));
      // A title in the unread middle is not seen; a title in the tail is.
      writeSync(fd, jsonl([{ type: "custom-title", customTitle: "middle" }]), 16 * 1024 * 1024);
      ftruncateSync(fd, CHAT_FULL_SCAN_MAX_BYTES + 4 * 1024 * 1024);
      writeSync(
        fd,
        `\n${JSON.stringify({ type: "ai-title", aiTitle: "tail title" })}\n`,
        CHAT_FULL_SCAN_MAX_BYTES + 4 * 1024 * 1024,
      );
    } finally {
      closeSync(fd);
    }
    expect(readChatTitle(path)).toEqual({ title: "tail title", titleSource: "ai" });
  });
});

describe("chat-sessions: listing", () => {
  it("lists only top-level <uuid>.jsonl files, newest first (subagents and other names excluded)", () => {
    const { home, dir } = fakeStore();
    writeSession(dir, uuid(1), [user("older")], 1_700_000_000);
    writeSession(dir, uuid(2), [user("newer")], 1_700_000_500);
    // Subagent transcripts live under <slug>/<uuid>/subagents/.
    mkdirSync(join(dir, uuid(2), "subagents"), { recursive: true });
    writeFileSync(join(dir, uuid(2), "subagents", `${uuid(3)}.jsonl`), jsonl([user("sub")]));
    // Non-UUID names never become sessions (their id lands in a shell command).
    writeFileSync(join(dir, "notes.jsonl"), jsonl([user("x")]));
    writeFileSync(join(dir, "$(touch pwned).jsonl"), jsonl([user("x")]));
    writeFileSync(join(dir, `${uuid(4)}.jsonl.bak`), jsonl([user("x")]));
    mkdirSync(join(dir, `${uuid(5)}.jsonl`)); // a directory named like a session

    const env = listClaudeSessions({ cwd: WORKSPACE, home });
    expect(env.status).toBe("ok");
    expect(env.projectDir).toBe(dir);
    expect(env.total).toBe(2);
    expect(env.sessions.map((s) => [s.id, s.title])).toEqual([
      [uuid(2), "newer"],
      [uuid(1), "older"],
    ]);
    expect(env.sessions[0]).toEqual({
      id: uuid(2),
      title: "newer",
      titleSource: "first-prompt",
      modified: 1_700_000_500_000,
      sizeBytes: expect.any(Number),
    });
    expect(Object.keys(env.sessions[0]).sort()).toEqual(
      ["id", "modified", "sizeBytes", "title", "titleSource"].sort(),
    );
  });

  it("keeps the file name's id as is and never follows symlinks", () => {
    const { home, dir } = fakeStore();
    const upper = "ABCDEF00-0000-4000-8000-000000000001";
    writeSession(dir, upper, [user("upper")]);
    const outside = join(mkdtempSync(join(tmpdir(), "ak-chats-outside-")), "secret.jsonl");
    writeFileSync(outside, jsonl([{ type: "custom-title", customTitle: "outside" }]));
    symlinkSync(outside, join(dir, `${uuid(9)}.jsonl`));
    const env = listClaudeSessions({ cwd: WORKSPACE, home });
    expect(env.sessions.map((s) => s.id)).toEqual([upper]);
  });

  it("finds sessions saved under the workspace's real path when given a symlink", () => {
    const real = mkdtempSync(join(tmpdir(), "ak-chats-real-"));
    const link = `${real}-link`;
    symlinkSync(real, link);
    const { home, dir } = fakeStore(real);
    writeSession(dir, uuid(1), [user("via realpath")]);
    const env = listClaudeSessions({ cwd: link, home });
    expect(env.status).toBe("ok");
    expect(env.projectDir).toBe(dir);
    expect(env.sessions[0].title).toBe("via realpath");
  });

  it("reads older transcripts through a small window once the scan budget is spent", () => {
    const { home, dir } = fakeStore();
    // Newest: a full read fits the budget. Older: its title sits in the middle, outside the window.
    writeSession(
      dir,
      uuid(1),
      [user("newest"), { type: "ai-title", aiTitle: "full read" }],
      1_700_000_100,
    );
    writeSession(
      dir,
      uuid(2),
      [
        user("older prompt"),
        { type: "assistant", pad: "x".repeat(1536 * 1024) },
        { type: "ai-title", aiTitle: "middle title" },
        { type: "assistant", pad: "y".repeat(1536 * 1024) },
      ],
      1_700_000_000,
    );
    const env = listClaudeSessions({
      cwd: WORKSPACE,
      home,
      scanBudgetBytes: 4096,
      cache: new Map(),
    });
    expect(env.sessions.map((s) => [s.title, s.titleSource])).toEqual([
      ["full read", "ai"],
      ["older prompt", "first-prompt"],
    ]);
  });

  it("caps the list and keeps the full total", () => {
    const { home, dir } = fakeStore();
    for (let i = 0; i < 7; i++) writeSession(dir, uuid(i), [user(`p${i}`)], 1_700_000_000 + i);
    const env = listClaudeSessions({ cwd: WORKSPACE, home, cap: 3 });
    expect(env.total).toBe(7);
    expect(env.sessions.map((s) => s.title)).toEqual(["p6", "p5", "p4"]);
    expect(CHAT_SESSIONS_CAP).toBe(200);
  });

  it("reuses the title cache until the file's mtime or size changes", () => {
    const { home, dir } = fakeStore();
    const path = writeSession(dir, uuid(1), [user("cached")], 1_700_000_000);
    const cache = new Map();
    listClaudeSessions({ cwd: WORKSPACE, home, cache });
    expect(cache.size).toBe(1);
    // Same stat key, poisoned entry: proves the cache answers instead of re-reading.
    const [key] = [...cache.keys()];
    cache.set(key, { title: "from cache", titleSource: "ai" });
    expect(listClaudeSessions({ cwd: WORKSPACE, home, cache }).sessions[0].title).toBe(
      "from cache",
    );
    writeFileSync(path, jsonl([user("cached"), { type: "ai-title", aiTitle: "changed" }]));
    utimesSync(path, 1_700_000_100, 1_700_000_100);
    expect(listClaudeSessions({ cwd: WORKSPACE, home, cache }).sessions[0].title).toBe("changed");
  });

  it("reports none for a missing folder, an empty folder or a missing HOME (never throws)", () => {
    const { home, dir } = fakeStore();
    expect(listClaudeSessions({ cwd: WORKSPACE, home })).toEqual({
      vendor: "claude",
      status: "none",
      projectDir: dir,
      sessions: [],
      total: 0,
    });
    expect(listClaudeSessions({ cwd: "/elsewhere", home }).status).toBe("none");
    expect(listClaudeSessions({ cwd: WORKSPACE, home: "" })).toEqual({
      vendor: "claude",
      status: "none",
      projectDir: null,
      sessions: [],
      total: 0,
    });
  });

  it("returns an explicit unsupported envelope for Codex and Cursor", () => {
    const { home } = fakeStore();
    const all = listChatSessions({ cwd: WORKSPACE, home });
    expect(all.map((v) => [v.vendor, v.status])).toEqual([
      ["claude", "none"],
      ["codex", "unsupported"],
      ["cursor", "unsupported"],
    ]);
    expect(all[1]).toEqual({
      vendor: "codex",
      status: "unsupported",
      projectDir: null,
      sessions: [],
      total: 0,
    });
  });
});

describe("chat-sessions: withholding (broadcast privacy)", () => {
  const SENTINEL = "private-sentinel-title-7f3a";

  it("collectChats returns nothing to read when withheld", () => {
    const { home, dir } = fakeStore();
    writeSession(dir, uuid(1), [{ type: "custom-title", customTitle: SENTINEL }]);
    expect(collectChats({ cwd: WORKSPACE, home }).vendors[0].sessions[0].title).toBe(SENTINEL);
    expect(collectChats({ cwd: WORKSPACE, home, withhold: true })).toEqual({
      withheld: true,
      vendors: [],
    });
  });

  it("withholdChats / withholdChatsFromPayload strip every session and keep the rest", () => {
    const { home, dir } = fakeStore();
    writeSession(dir, uuid(1), [{ type: "custom-title", customTitle: SENTINEL }]);
    const snapshot = { plans: [1], chats: collectChats({ cwd: WORKSPACE, home }) };
    const payload = JSON.stringify(snapshot);
    expect(payload).toContain(SENTINEL);
    expect(withholdChats(snapshot)).toEqual({ plans: [1], chats: { withheld: true, vendors: [] } });
    const stripped = withholdChatsFromPayload(payload);
    expect(stripped).not.toContain(SENTINEL);
    expect(stripped).not.toContain(uuid(1));
    expect(JSON.parse(stripped)).toEqual({ plans: [1], chats: { withheld: true, vendors: [] } });
    expect(withholdChatsFromPayload("not json")).toBe("not json");
  });
});

describe("chat-sessions: resume command and age", () => {
  it("quotes the workspace for the shell", () => {
    expect(shellQuote("/home/me/app")).toBe("/home/me/app");
    expect(shellQuote("/home/me/my app")).toBe("'/home/me/my app'");
    expect(shellQuote("/x/it's; rm -rf ~")).toBe("'/x/it'\\''s; rm -rf ~'");
    expect(claudeResumeCommand("/home/me/app", uuid(1))).toBe(
      `cd /home/me/app && claude --resume ${uuid(1)}`,
    );
  });

  it("formats ages in the Mission Control buckets", () => {
    const now = 1_700_000_000_000;
    expect(formatChatAge(now - 2_000, now)).toBe("just now");
    expect(formatChatAge(now - 30_000, now)).toBe("30s ago");
    expect(formatChatAge(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatChatAge(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatChatAge(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(formatChatAge(now + 60_000, now)).toBe("just now");
  });
});
