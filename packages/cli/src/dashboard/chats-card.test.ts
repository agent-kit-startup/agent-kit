// Mission Control Chats card (dashboard.html): runs the shipped render functions in a sandbox.
// Chat titles are user content, so the card must escape them; the resume command it copies must
// match the CLI's builder in dashboard/lib/chat-sessions.mjs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { claudeResumeCommand } from "../../../../dashboard/lib/chat-sessions.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const html = readFileSync(resolve(repoRoot, "dashboard/dashboard.html"), "utf8");

function fn(name: string): string {
  const m = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(html);
  if (!m) throw new Error(`function ${name} not found in dashboard.html`);
  return m[0];
}

function constant(name: string): string {
  const m = new RegExp(`const ${name} =[\\s\\S]*?;\\n`).exec(html);
  if (!m) throw new Error(`const ${name} not found in dashboard.html`);
  return m[0];
}

type Card = {
  renderChatsSection: (d: unknown) => string;
  chatResumeCommand: (workspace: string, id: string) => string;
  chatsTotal: (d: unknown) => number;
  spaceIconSvg: (kind: string, opts?: { decorative?: boolean }) => string;
};

function loadCard(): Card {
  const body = [
    constant("PASTE_DESTINATIONS"),
    constant("PROMPT_RESUME_GUIDANCE"),
    ...[
      "escapeHtml",
      "escapeAttr",
      "escapeJsString",
      "relativeTime",
      "pasteDestinationLabel",
      "isPasteOnlyShellTarget",
      "copyActionTitle",
      "copyForPasteHandler",
      "spaceIconSvg",
      "renderEmptyStateCta",
      "chatShellQuote",
      "chatResumeCommand",
      "claudeChatsEnvelope",
      "chatsTotal",
      "renderChatsSection",
    ].map(fn),
    "return { renderChatsSection, chatResumeCommand, chatsTotal, spaceIconSvg };",
  ].join("\n");
  return runInNewContext(`(function(){\n${body}\n})()`, { Date, Number, Array, String }) as Card;
}

const ID = "66666666-6666-4666-8666-666666666666";

function snapshot(title: string | null, extra: Record<string, unknown> = {}) {
  return {
    system: { repoRoot: "/home/me/my app" },
    chats: {
      withheld: false,
      vendors: [
        {
          vendor: "claude",
          status: "ok",
          projectDir: "/home/me/.claude/projects/-home-me-my-app",
          sessions: [
            { id: ID, title, titleSource: "custom", modified: Date.now() - 120_000, sizeBytes: 10 },
          ],
          total: 1,
        },
        { vendor: "codex", status: "unsupported", projectDir: null, sessions: [], total: 0 },
        { vendor: "cursor", status: "unsupported", projectDir: null, sessions: [], total: 0 },
      ],
    },
    ...extra,
  };
}

describe("Mission Control Chats card", () => {
  it("escapes a hostile title in text and attributes", () => {
    const card = loadCard();
    const evil = `<img src=x onerror=alert(1)>" onmouseover="alert(2)`;
    const out = card.renderChatsSection(snapshot(evil));
    expect(out).not.toContain("<img");
    expect(out).not.toContain('" onmouseover="');
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;&quot; onmouseover=&quot;alert(2)");
    expect(out).toContain('id="section-chats"');
    expect(out).toContain("2m ago");
    expect(out).toContain(">66666666<");
    expect(out).toContain("Codex: not supported yet · Cursor: not supported yet");
  });

  it("copies the same resume command the CLI builds (workspace quoted for the shell)", () => {
    const card = loadCard();
    for (const ws of ["/home/me/app", "/home/me/my app", "/x/it's; rm -rf ~", "/a/$(id)/b"]) {
      expect(card.chatResumeCommand(ws, ID)).toBe(claudeResumeCommand(ws, ID));
    }
    const out = card.renderChatsSection(snapshot("ok"));
    expect(out).toContain(
      `data-chat-resume="cd &#39;/home/me/my app&#39; &amp;&amp; claude --resume ${ID}"`,
    );
    // Wired by a delegated listener: no new inline handler on the row.
    expect(out).not.toContain("onclick=");
  });

  it("shows the per-folder empty state, the broadcast notice and an untitled row", () => {
    const card = loadCard();
    const empty = card.renderChatsSection({ system: { repoRoot: "/w" } });
    expect(empty).toContain("No saved chats");
    expect(empty).toContain("The agent CLI saves each session per folder");
    expect(card.chatsTotal({})).toBe(0);

    const withheld = card.renderChatsSection({ chats: { withheld: true, vendors: [] } });
    expect(withheld).toContain("Chats stay private");
    expect(withheld).not.toContain("chat-item");

    const untitled = card.renderChatsSection(snapshot(null));
    expect(untitled).toContain('data-untitled="true"');
    expect(untitled).toContain("Untitled chat");
    expect(card.chatsTotal(snapshot(null))).toBe(1);
  });

  it("registers the section, its nav entry and a 16/1.5 icon", () => {
    const card = loadCard();
    expect(html).toMatch(/const SECTION_IDS = \[[\s\S]*'chats',[\s\S]*\];/);
    expect(html).toContain('data-section="chats"');
    expect(html).toContain('id="navChatsBadge"');
    const icon = card.spaceIconSvg("chats", { decorative: false });
    expect(icon).toContain('width="16" height="16"');
    expect(icon).toContain('stroke-width="1.5"');
    expect(icon).toContain('aria-label="Chats"');
    expect(html).toContain("wireChatResumeButtons();");
  });
});
