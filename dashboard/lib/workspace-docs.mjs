/**
 * Workspace documents for the Mission Control snapshot (1.10.0): the rules
 * (`.cursor/rules/*.mdc|*.md`) and a decision index over
 * `.cursor/memory/decisions/*.md` (title, date, Status, tags).
 *
 * A host (the Colony Workspace view: Rules, Decisions/ADR) lists these natively and
 * opens the file itself by its repo-relative `path`; bodies never ship in the snapshot.
 * Read-only, bounded (entry caps, byte caps per file, string caps), and never throws:
 * an unreadable file degrades to an entry with empty fields, a missing directory to [].
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const RULES_CAP = 200;
export const DECISION_INDEX_CAP = 600;
/** Bytes parsed per file: frontmatter and the Status line sit at the top, Tags at the end. */
export const DOC_READ_MAX_BYTES = 256 * 1024;
export const DOC_TITLE_MAX = 200;
export const DOC_DESCRIPTION_MAX = 400;
export const DOC_STATUS_TEXT_MAX = 160;
export const DOC_TAGS_MAX = 10;
export const DOC_TAG_MAX = 60;

/** The per-file Status vocabulary of `memory-loop.mdc` (decisions `_index.md` Convention). */
export const DECISION_STATUSES = Object.freeze([
  "proposed",
  "accepted",
  "deprecated",
  "superseded",
]);

function cap(value, max) {
  const s = String(value ?? "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function readCapped(full) {
  try {
    const st = statSync(full);
    if (!st.isFile()) return { raw: null, modifiedAt: null };
    const modifiedAt = st.mtime.toISOString();
    try {
      const buf = readFileSync(full);
      return { raw: buf.subarray(0, DOC_READ_MAX_BYTES).toString("utf8"), modifiedAt };
    } catch {
      return { raw: null, modifiedAt };
    }
  } catch {
    return { raw: null, modifiedAt: null };
  }
}

/** Unquote a YAML scalar (`"a"`, `'a'`) without a YAML dependency. */
function scalar(v) {
  const s = String(v ?? "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse one rule file (Cursor `.mdc` frontmatter: `description`, `alwaysApply`, `globs`).
 * `globs` may be a comma list, a flow list `[a, b]` or a block list of `- a` lines.
 *
 * @param {string} file - basename under `.cursor/rules/`
 * @param {string | null} raw - file text (null when unreadable)
 */
export function parseRuleFile(file, raw) {
  const id = file.replace(/\.(mdc|md)$/, "");
  const out = {
    id,
    file,
    path: `.cursor/rules/${file}`,
    description: "",
    alwaysApply: false,
    globs: [],
  };
  if (typeof raw !== "string") return out;
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const body = fm ? raw.slice(fm[0].length) : raw;
  if (fm) {
    const lines = fm[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z]+):\s*(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      if (key === "description") out.description = cap(scalar(value), DOC_DESCRIPTION_MAX);
      else if (key === "alwaysApply") out.alwaysApply = /^true$/i.test(scalar(value));
      else if (key === "globs") {
        let items = [];
        const v = value.trim();
        if (v.startsWith("[")) items = v.replace(/^\[|\]$/g, "").split(",");
        else if (v) items = v.split(",");
        else {
          while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
            items.push(lines[++i].replace(/^\s+-\s+/, ""));
          }
        }
        out.globs = items
          .map((g) => cap(scalar(g), DOC_TAG_MAX * 2))
          .filter(Boolean)
          .slice(0, DOC_TAGS_MAX);
      }
    }
  }
  if (!out.description) {
    const h = body.match(/^#\s+(.+)$/m);
    if (h) out.description = cap(h[1], DOC_DESCRIPTION_MAX);
  }
  return out;
}

/**
 * Rules of the workspace, sorted by id, capped at RULES_CAP.
 *
 * @param {string} root - repository root
 * @param {{ kitPaths?: Set<string> }} [opts] - repo-relative paths owned by kit updates
 */
export function collectRules(root, opts = {}) {
  const dir = join(root, ".cursor", "rules");
  if (!existsSync(dir)) return [];
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /\.(mdc|md)$/.test(f) && !f.startsWith("."));
  } catch {
    return [];
  }
  const kit = opts.kitPaths instanceof Set ? opts.kitPaths : new Set();
  return files
    .sort()
    .slice(0, RULES_CAP)
    .map((f) => {
      const { raw, modifiedAt } = readCapped(join(dir, f));
      const rule = parseRuleFile(f, raw);
      return { ...rule, kitManaged: kit.has(rule.path), modifiedAt };
    });
}

/**
 * Normalize a Status line to the memory-loop vocabulary: the first word decides
 * (`Accepted 2026-10-25 (...)` -> accepted, `Superseded by x.md` -> superseded).
 */
export function decisionStatus(text) {
  const w = String(text ?? "")
    .replace(/^[\s*_`]+/, "")
    .split(/[^A-Za-z]/)[0]
    .toLowerCase();
  return DECISION_STATUSES.includes(w) ? w : "unknown";
}

function splitTags(text) {
  return String(text ?? "")
    .split(",")
    .map((t) => cap(t.replace(/[`*]/g, ""), DOC_TAG_MAX))
    .filter(Boolean)
    .slice(0, DOC_TAGS_MAX);
}

/**
 * Parse one decision record. Fields: `# Title`, `- **Date:**`, the first
 * `- **Status:**` line, tags from `- **Tags:**` or the line after a `## Tags` heading,
 * and the dates of `## Amend (...)` headings.
 *
 * @param {string} file - basename under `.cursor/memory/decisions/`
 * @param {string | null} raw - file text (null when unreadable)
 */
export function parseDecisionFile(file, raw) {
  const id = file.replace(/\.md$/, "");
  const out = {
    id,
    path: `.cursor/memory/decisions/${file}`,
    title: id,
    date: (id.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || "",
    status: "unknown",
    statusText: "",
    tags: [],
    amends: [],
  };
  if (typeof raw !== "string") return out;
  const title = raw.match(/^#\s+(.+)$/m);
  if (title) out.title = cap(title[1], DOC_TITLE_MAX);
  const date = raw.match(/^[-*]\s+\*\*(?:Date|Data):\*\*\s*(\d{4}-\d{2}-\d{2})/m);
  if (date) out.date = date[1];
  const status = raw.match(/^[-*]\s+\*\*Status:\*\*\s*(.+)$/m);
  if (status) {
    out.statusText = cap(status[1], DOC_STATUS_TEXT_MAX);
    out.status = decisionStatus(status[1]);
  }
  const inlineTags = raw.match(/^[-*]?\s*\*\*Tags:\*\*\s*(.+)$/m);
  if (inlineTags) out.tags = splitTags(inlineTags[1]);
  else {
    const block = raw.match(/^##\s+Tags\s*\r?\n+([^\n#][^\n]*)/m);
    if (block) out.tags = splitTags(block[1]);
  }
  const amends = new Set();
  for (const m of raw.matchAll(/^##\s+Amend[^\n]*?(\d{4}-\d{2}-\d{2})/gm)) amends.add(m[1]);
  out.amends = [...amends].sort().slice(0, DOC_TAGS_MAX);
  return out;
}

/**
 * Decision index, newest file name first (names are date-prefixed), capped at
 * DECISION_INDEX_CAP. `_index.md` and the `archive/` folder are not records.
 *
 * @param {string} root - repository root
 */
export function collectDecisionIndex(root) {
  const dir = join(root, ".cursor", "memory", "decisions");
  if (!existsSync(dir)) return [];
  let files = [];
  try {
    files = readdirSync(dir).filter(
      (f) => f.endsWith(".md") && !f.startsWith("_") && !f.startsWith("."),
    );
  } catch {
    return [];
  }
  return files
    .sort()
    .reverse()
    .slice(0, DECISION_INDEX_CAP)
    .map((f) => {
      const { raw, modifiedAt } = readCapped(join(dir, f));
      return { ...parseDecisionFile(f, raw), modifiedAt };
    });
}
