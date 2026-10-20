/**
 * Saved agent chat sessions for one workspace (the "Chats" list).
 *
 * Shared by `agent-kit sessions` (packages/cli) and Mission Control
 * (dashboard-data.mjs). Colony reads the same contract natively, so the field
 * names below are fixed:
 *   envelope: { vendor, status: "ok"|"unsupported"|"none", projectDir, sessions, total }
 *   session:  { id, title, titleSource: "custom"|"ai"|"first-prompt"|"none", modified, sizeBytes }
 * `status` is "none" when the workspace has no saved session (no folder, no HOME,
 * unreadable folder, or an empty one), "unsupported" for a vendor this reader
 * does not parse yet. `sessions` is newest first and capped; `total` counts all.
 *
 * Claude Code stores each session as ~/.claude/projects/<slug>/<uuid>.jsonl,
 * one JSON record per line. Subagent transcripts live under <slug>/<uuid>/ and
 * are not sessions. Read-only: this module never writes.
 */
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export const CHAT_SESSIONS_CAP = 200;
/** First-prompt titles are cut to this many characters. */
export const CHAT_TITLE_MAX = 80;
/** Custom and generated titles are kept whole up to this safety bound. */
export const CHAT_NAMED_TITLE_MAX = 200;
/** Files above this size are read head + tail only (titles are appended, the first prompt is near the top). */
export const CHAT_FULL_SCAN_MAX_BYTES = 64 * 1024 * 1024;
export const CHAT_HEAD_BYTES = 2 * 1024 * 1024;
export const CHAT_TAIL_BYTES = 8 * 1024 * 1024;
/**
 * Bytes one listing may read in full. Past it, the remaining (older) transcripts are read
 * through a small head + tail window, so 200 large sessions cannot stall a snapshot.
 */
export const CHAT_SCAN_BUDGET_BYTES = 256 * 1024 * 1024;
const BUDGET_HEAD_BYTES = 256 * 1024;
const BUDGET_TAIL_BYTES = 1024 * 1024;
export const CHAT_VENDORS = Object.freeze(["claude", "codex", "cursor"]);

const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const SLUG_MAX = 200;
const READ_CHUNK = 1024 * 1024;
const NEWLINE = 0x0a;

const MARK_CUSTOM = Buffer.from('"type":"custom-title"');
const MARK_AI = Buffer.from('"type":"ai-title"');
const MARK_USER = Buffer.from('"type":"user"');

/** Prompt text that is harness plumbing, not something the operator typed. */
const NON_PROMPT_PREFIXES = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
  "<system-reminder>",
  "<task-notification>",
  "Caveat:",
  "[Request interrupted",
];

/** Java-style 32-bit string hash over UTF-16 code units (Claude Code's long-slug suffix). */
function slugHash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  return h;
}

/**
 * Claude Code project folder name for a working directory: every character that is
 * not an ASCII letter or digit becomes "-" (so "/" and "." do, and a ".cursor"
 * segment becomes "--cursor"); names over 200 characters are cut and get a hash suffix.
 * @param {string} cwd absolute working directory
 * @returns {string}
 */
export function claudeProjectSlug(cwd) {
  const raw = String(cwd ?? "");
  const slug = raw.replace(/[^a-zA-Z0-9]/g, "-");
  if (slug.length <= SLUG_MAX) return slug;
  return `${slug.slice(0, SLUG_MAX)}-${Math.abs(slugHash(raw)).toString(36)}`;
}

/**
 * ~/.claude/projects/<slug> for `cwd`, or null without a usable HOME.
 * @param {string} cwd
 * @param {{ home?: string | null }} [opts]
 */
export function claudeProjectDir(cwd, opts = {}) {
  const home = opts.home === undefined ? process.env.HOME : opts.home;
  if (typeof home !== "string" || !home.trim() || !home.startsWith("/")) return null;
  return join(home, ".claude", "projects", claudeProjectSlug(cwd));
}

/**
 * Display-safe single line: control characters (incl. ANSI escapes and bidi
 * overrides) removed, whitespace collapsed, cut to `max` characters.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export function cleanChatTitle(value, max = CHAT_TITLE_MAX) {
  const text = String(value ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

/** First operator-typed text of a user record, or "" when it is meta, a command or a tool result. */
function promptText(record) {
  if (record?.type !== "user" || record.isMeta === true || record.isSidechain === true) {
    return "";
  }
  const content = record.message?.content;
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((part) => part && part.type === "tool_result")) return "";
    text = content
      .filter((part) => part && part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join(" ");
  }
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (NON_PROMPT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return "";
  return trimmed;
}

function parseRecord(line) {
  try {
    const value = JSON.parse(line.toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Stream complete lines of byte range [start, end) to `onLine` (Buffer per line).
 * The first line is dropped when `start` is mid-file (it is a partial record).
 */
function forEachLine(fd, start, end, onLine) {
  const buf = Buffer.allocUnsafe(READ_CHUNK);
  /** @type {Buffer[]} */
  let pending = [];
  let skipFirst = start > 0;
  let pos = start;
  while (pos < end) {
    const n = readSync(fd, buf, 0, Math.min(READ_CHUNK, end - pos), pos);
    if (n <= 0) break;
    pos += n;
    let from = 0;
    for (;;) {
      const nl = buf.indexOf(NEWLINE, from);
      if (nl === -1 || nl >= n) {
        if (from < n) pending.push(Buffer.from(buf.subarray(from, n)));
        break;
      }
      const piece = buf.subarray(from, nl);
      const line = pending.length ? Buffer.concat([...pending, piece]) : piece;
      pending = [];
      from = nl + 1;
      if (skipFirst) {
        skipFirst = false;
        continue;
      }
      onLine(line);
    }
  }
  // A trailing record without a newline is still a record (only at true EOF).
  if (pending.length && !skipFirst) onLine(Buffer.concat(pending));
}

/**
 * Title of one session transcript. Precedence: last custom-title > last ai-title >
 * first typed prompt (cut to CHAT_TITLE_MAX) > none. Lines are JSON-parsed only
 * when their raw bytes carry a marker; malformed lines are skipped. A file above
 * `fullScanMaxBytes` is read through its first `headBytes` and last `tailBytes` only.
 * @param {string} filePath
 * @param {{ fullScanMaxBytes?: number, headBytes?: number, tailBytes?: number }} [window]
 * @returns {{ title: string | null, titleSource: "custom"|"ai"|"first-prompt"|"none" }}
 */
export function readChatTitle(filePath, window = {}) {
  const fullScanMax = window.fullScanMaxBytes ?? CHAT_FULL_SCAN_MAX_BYTES;
  const headBytes = window.headBytes ?? CHAT_HEAD_BYTES;
  const tailBytes = window.tailBytes ?? CHAT_TAIL_BYTES;
  let custom = "";
  let ai = "";
  let prompt = "";
  let fd;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return { title: null, titleSource: "none" };
  }
  try {
    const size = fstatSync(fd).size;
    const visit = (line) => {
      if (line.indexOf(MARK_CUSTOM) !== -1) {
        const rec = parseRecord(line);
        if (rec?.type === "custom-title" && typeof rec.customTitle === "string") {
          const t = cleanChatTitle(rec.customTitle, CHAT_NAMED_TITLE_MAX);
          if (t) custom = t;
        }
        return;
      }
      if (line.indexOf(MARK_AI) !== -1) {
        const rec = parseRecord(line);
        if (rec?.type === "ai-title" && typeof rec.aiTitle === "string") {
          const t = cleanChatTitle(rec.aiTitle, CHAT_NAMED_TITLE_MAX);
          if (t) ai = t;
        }
        return;
      }
      if (!prompt && line.indexOf(MARK_USER) !== -1) {
        prompt = cleanChatTitle(promptText(parseRecord(line)));
      }
    };
    if (size <= fullScanMax || size <= headBytes + tailBytes) {
      forEachLine(fd, 0, size, visit);
    } else {
      forEachLine(fd, 0, headBytes, visit);
      forEachLine(fd, size - tailBytes, size, visit);
    }
  } catch {
    // Unreadable mid-way: keep whatever was found.
  } finally {
    closeSync(fd);
  }
  if (custom) return { title: custom, titleSource: "custom" };
  if (ai) return { title: ai, titleSource: "ai" };
  if (prompt) return { title: prompt, titleSource: "first-prompt" };
  return { title: null, titleSource: "none" };
}

/** Module-level title cache keyed by path + mtime + size (one entry per transcript version). */
const defaultTitleCache = new Map();

/**
 * @param {string} vendor
 * @param {"ok"|"unsupported"|"none"} status
 * @param {string | null} projectDir
 */
function envelope(vendor, status, projectDir, sessions = [], total = 0) {
  return { vendor, status, projectDir, sessions, total };
}

/**
 * Project folders to try for `cwd`: the path as given, then its resolved real path
 * (Claude Code keys sessions on the physical working directory).
 * @param {string} cwd
 * @param {string | null | undefined} home
 * @returns {string[]}
 */
function claudeProjectDirCandidates(cwd, home) {
  const out = [];
  const first = claudeProjectDir(cwd, { home });
  if (!first) return out;
  out.push(first);
  try {
    const real = realpathSync(cwd);
    const second = claudeProjectDir(real, { home });
    if (second && second !== first) out.push(second);
  } catch {
    // Workspace path does not exist (or is unreadable): the given path is all we have.
  }
  return out;
}

/**
 * Claude Code sessions saved for `cwd`.
 * @param {{ cwd: string, home?: string | null, cap?: number, scanBudgetBytes?: number, cache?: Map<string, {title: string|null, titleSource: string}> }} opts
 */
export function listClaudeSessions(opts) {
  const cap = Number.isInteger(opts?.cap) && opts.cap >= 0 ? opts.cap : CHAT_SESSIONS_CAP;
  const cache = opts?.cache ?? defaultTitleCache;
  const candidates = claudeProjectDirCandidates(String(opts?.cwd ?? ""), opts?.home);
  if (candidates.length === 0) return envelope("claude", "none", null);
  const projectDir = candidates.find((dir) => existsSync(dir)) ?? candidates[0];
  let entries;
  try {
    entries = readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return envelope("claude", "none", projectDir);
  }
  const found = [];
  for (const entry of entries) {
    // Regular files only: subagent folders, symlinks and FIFOs are never opened.
    if (!entry.isFile()) continue;
    const m = SESSION_FILE_RE.exec(entry.name);
    if (!m) continue;
    const path = join(projectDir, entry.name);
    try {
      const st = statSync(path);
      found.push({ id: m[1], path, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // Vanished between readdir and stat.
    }
  }
  if (found.length === 0) return envelope("claude", "none", projectDir);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.id < b.id ? -1 : 1));
  let budget = opts?.scanBudgetBytes ?? CHAT_SCAN_BUDGET_BYTES;
  const sessions = found.slice(0, cap).map((f) => {
    const key = `${f.path}\u0000${f.mtimeMs}\u0000${f.size}`;
    let title = cache.get(key);
    if (!title) {
      const cost = f.size <= CHAT_FULL_SCAN_MAX_BYTES ? f.size : CHAT_HEAD_BYTES + CHAT_TAIL_BYTES;
      if (cost <= budget) {
        title = readChatTitle(f.path);
        budget -= cost;
        cache.set(key, title);
      } else {
        // Budget spent: a small window, not cached as a full read.
        title = readChatTitle(f.path, {
          fullScanMaxBytes: 0,
          headBytes: BUDGET_HEAD_BYTES,
          tailBytes: BUDGET_TAIL_BYTES,
        });
      }
    }
    return {
      id: f.id,
      title: title.title,
      titleSource: title.titleSource,
      modified: Math.floor(f.mtimeMs),
      sizeBytes: f.size,
    };
  });
  return envelope("claude", "ok", projectDir, sessions, found.length);
}

/**
 * One envelope per vendor (Claude Code read; Codex and Cursor explicitly unsupported).
 * @param {{ cwd: string, home?: string | null, cap?: number, cache?: Map<string, any> }} opts
 */
export function listChatSessions(opts) {
  return CHAT_VENDORS.map((vendor) =>
    vendor === "claude" ? listClaudeSessions(opts) : envelope(vendor, "unsupported", null),
  );
}

/**
 * Snapshot / `--json` shape: `{ withheld, vendors }`. `withheld` is true when the
 * list was left out on purpose (Mission Control broadcast mode: titles are private).
 * @param {{ cwd: string, home?: string | null, cap?: number, cache?: Map<string, any>, withhold?: boolean }} opts
 */
export function collectChats(opts) {
  if (opts?.withhold) return { withheld: true, vendors: [] };
  return { withheld: false, vendors: listChatSessions(opts) };
}

/**
 * Drop chat data from a parsed snapshot before it leaves the machine (broadcast).
 * Returns a shallow copy; other fields are untouched.
 * @template {Record<string, unknown>} T
 * @param {T} snapshot
 * @returns {T}
 */
export function withholdChats(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  return { ...snapshot, chats: { withheld: true, vendors: [] } };
}

/**
 * Same as `withholdChats` for the serialized payload serve.mjs caches and pushes.
 * Unparseable payloads pass through (they carry no snapshot).
 * @param {string} payload
 * @returns {string}
 */
export function withholdChatsFromPayload(payload) {
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return payload;
    return JSON.stringify(withholdChats(parsed));
  } catch {
    return payload;
  }
}

/**
 * POSIX single-quote a path for a pasted shell command.
 * @param {string} value
 */
export function shellQuote(value) {
  const s = String(value ?? "");
  if (/^[A-Za-z0-9_./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Command that reopens a session from any terminal.
 * @param {string} workspace absolute workspace path (the session's cwd)
 * @param {string} id session uuid
 */
export function claudeResumeCommand(workspace, id) {
  return `cd ${shellQuote(workspace)} && claude --resume ${shellQuote(id)}`;
}

/**
 * "just now" / "5m ago" / "3h ago" / "2d ago" (same buckets as Mission Control).
 * @param {number} modifiedMs
 * @param {number} [nowMs]
 */
export function formatChatAge(modifiedMs, nowMs = Date.now()) {
  const secs = Math.floor(Math.max(0, nowMs - modifiedMs) / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
