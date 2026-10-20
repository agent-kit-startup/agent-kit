import path from "node:path";
import { defineCommand } from "citty";
import {
  type ChatSessionsEnvelope,
  type ChatsSnapshot,
  cleanChatTitle,
  collectChats,
  formatChatAge,
  shellQuote,
} from "../../../../dashboard/lib/chat-sessions.mjs";

const VENDOR_LABEL: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};
const TITLE_COLUMN = 48;

function vendorLabel(vendor: string): string {
  return VENDOR_LABEL[vendor] ?? vendor;
}

/**
 * Human table: title, relative time, short id and the resume command, newest first.
 * `workspace` is the folder the sessions belong to; `cwd` is where the operator runs
 * the command (the resume line gets a `cd` when they differ).
 */
export function renderChatSessions(
  chats: ChatsSnapshot,
  opts: { workspace: string; cwd?: string; now?: number },
): string {
  const now = opts.now ?? Date.now();
  const needsCd = path.resolve(opts.cwd ?? opts.workspace) !== path.resolve(opts.workspace);
  const lines: string[] = [];
  const claude = chats.vendors.find((v) => v.vendor === "claude");
  if (claude?.status !== "ok") {
    lines.push(`No saved Claude Code chats for ${opts.workspace}.`);
    lines.push(
      "The agent CLI saves sessions per folder: start `claude` in this folder to create one.",
    );
  } else {
    const shown = claude.sessions.length;
    const count =
      shown < claude.total ? `${shown} newest of ${claude.total}` : `${claude.total} saved`;
    lines.push(`Claude Code chats for ${opts.workspace} (${count})`);
    lines.push("");
    const ageWidth = Math.max(...claude.sessions.map((s) => formatChatAge(s.modified, now).length));
    for (const s of claude.sessions) {
      const title = cleanChatTitle(s.title ?? "(untitled)", TITLE_COLUMN).padEnd(TITLE_COLUMN);
      const age = formatChatAge(s.modified, now).padEnd(ageWidth);
      lines.push(`  ${title}  ${age}  ${s.id.slice(0, 8)}  claude --resume ${s.id}`);
    }
    if (needsCd) {
      lines.push("");
      lines.push(`Resume from that folder: cd ${shellQuote(opts.workspace)} first.`);
    }
  }
  const unsupported = chats.vendors.filter((v: ChatSessionsEnvelope) => v.status === "unsupported");
  if (unsupported.length > 0) {
    lines.push("");
    lines.push(unsupported.map((v) => `${vendorLabel(v.vendor)}: not supported yet`).join(" · "));
  }
  return lines.join("\n");
}

/**
 * The workspace's saved agent chats (Claude Code today). Same reader and contract as the
 * Mission Control Chats card (`dashboard/lib/chat-sessions.mjs`).
 */
export const sessionsCommand = defineCommand({
  meta: {
    name: "sessions",
    description: "List this folder's saved agent chats with the command that resumes each one",
  },
  args: {
    json: {
      type: "boolean",
      description: "Print {withheld, vendors[]} as JSON (one envelope per vendor)",
      default: false,
    },
    cwd: {
      type: "string",
      description: "Workspace folder whose chats to list (default: current directory)",
    },
  },
  run({ args }) {
    const cwd = process.cwd();
    const workspace = path.resolve(cwd, typeof args.cwd === "string" && args.cwd ? args.cwd : ".");
    const chats = collectChats({ cwd: workspace });
    process.stdout.write(
      args.json
        ? `${JSON.stringify(chats, null, 2)}\n`
        : `${renderChatSessions(chats, { workspace, cwd })}\n`,
    );
  },
});
