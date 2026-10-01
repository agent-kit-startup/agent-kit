/**
 * HANDOFF excerpt for the sessionStart hook: a line cap plus a byte budget.
 *
 * Machine fields (Plan, Run queue, Queue cursor, …) are selected from the
 * **whole** file first, then the remaining line budget is filled from the
 * top. That closes the lazy-layers Phase 4 carve-out where queue fields past
 * line 60 were dropped by `slice(0, 60)` before the byte budget ran.
 *
 * Within the selected lines, machine fields stay whole under the byte cap:
 * prose is water-filled, truncated at a code-point boundary with a visible
 * marker, and dropped last-first only when the per-line floor still does not
 * fit. Headings and blank lines are structural. An over-budget prose value
 * that is inline JSON becomes a `(JSON, N entries; read HANDOFF)` marker
 * instead of a mid-JSON slice. Last resort: when machine lines alone still
 * exceed the byte cap, the longest ones are truncated (`machineTruncated`).
 *
 * Both hook formats (`--format cursor` JSON and `--format claude` plain
 * text) wrap the same excerpt, so the cap applies to both.
 */

/** Outer bound on selected lines (not "first N lines of the file"). */
export const HANDOFF_EXCERPT_MAX_LINES = 60;

/**
 * 12 KiB. Measured on the factory HANDOFF (60 lines, 61,401 B, 44 prose
 * lines) and on a consumer HANDOFF (60 lines, 38,046 B): 12 KiB keeps every
 * selected line present with about 200 bytes per prose line.
 */
export const HANDOFF_EXCERPT_MAX_BYTES = 12 * 1024;

/** Smallest slice of a prose line worth keeping (label plus one clause). */
export const HANDOFF_PROSE_LINE_MIN_BYTES = 160;

/** Bullet labels that are read by machines and are never truncated. */
export const HANDOFF_MACHINE_FIELDS: ReadonlySet<string> = new Set([
  "Plan",
  "Last updated",
  "Mode",
  "In progress",
  "Next",
  "Next phase",
  "Next to-dos",
  "Backlog",
  "Backlog plans",
  "Parked plans",
  "Run queue",
  "Queue cursor",
  "Queue status",
  "Queue outcomes",
]);

export interface HandoffExcerptOptions {
  maxLines?: number;
  maxBytes?: number;
  proseLineMinBytes?: number;
}

export interface HandoffExcerptResult {
  text: string;
  bytes: number;
  /** Lines selected into the excerpt (after field-priority + line cap). */
  lines: number;
  truncatedLines: number;
  droppedLines: number;
  /** Machine lines truncated because they alone exceeded the byte cap. */
  machineTruncated: number;
}

type LineKind = "machine" | "structural" | "prose";

interface Entry {
  text: string;
  kind: LineKind;
  bytes: number;
}

const FIELD_BULLET = /^- \*\*([^*\n]+?):\*\*/;

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function classify(lines: string[]): Entry[] {
  const entries: Entry[] = [];
  let lastBullet: LineKind = "structural";
  for (const text of lines) {
    let kind: LineKind;
    if (!text.trim() || /^#{1,6}\s/.test(text)) {
      kind = "structural";
    } else if (/^\s+\S/.test(text)) {
      // Indented continuation inherits the kind of the bullet above it.
      kind = lastBullet;
    } else {
      const m = FIELD_BULLET.exec(text);
      kind = m?.[1] && HANDOFF_MACHINE_FIELDS.has(m[1].trim()) ? "machine" : "prose";
      lastBullet = kind;
    }
    entries.push({ text, kind, bytes: byteLength(text) });
  }
  return entries;
}

/**
 * Field-priority line selection: keep every machine bullet (and its indented
 * continuations) from the full file, then fill remaining slots from the top.
 * Preserves relative order of selected lines.
 */
function selectByFieldPriority(entries: Entry[], maxLines: number): Entry[] {
  if (entries.length <= maxLines) return entries;

  const mustKeep = new Set<number>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    if (e.kind === "machine") mustKeep.add(i);
  }

  // Prefer the document title when present.
  if (entries[0] && /^#\s/.test(entries[0].text)) mustKeep.add(0);

  const selected = new Set<number>(mustKeep);
  for (let i = 0; i < entries.length && selected.size < maxLines; i++) {
    selected.add(i);
  }

  // If machine fields alone exceed the line cap, keep earliest machine/title
  // indices so the excerpt stays bounded (byte cap still applies).
  if (mustKeep.size > maxLines) {
    const ordered = [...mustKeep].sort((a, b) => a - b).slice(0, maxLines);
    return ordered.flatMap((i) => {
      const e = entries[i];
      return e ? [e] : [];
    });
  }

  return [...selected]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const e = entries[i];
      return e ? [e] : [];
    });
}

/** Cut at a code-point boundary so multibyte prose never corrupts. */
function truncateToBytes(text: string, maxBytes: number): { kept: string; removedChars: number } {
  let used = 0;
  let kept = "";
  let keptChars = 0;
  const total = Array.from(text).length;
  for (const ch of text) {
    const b = byteLength(ch);
    if (used + b > maxBytes) break;
    used += b;
    kept += ch;
    keptChars += 1;
  }
  return { kept: kept.trimEnd(), removedChars: total - keptChars };
}

/** Reserved so the marker never pushes a truncated line over its share. */
const MARKER_RESERVE_BYTES = 32;

function truncationMarker(removedChars: number): string {
  return ` …[truncated ${removedChars} chars]`;
}

/** Value after a `- **Label:**` prefix (or bullet dash) when it opens inline JSON. */
function jsonValue(text: string): { prefix: string; value: string } | null {
  const head = (FIELD_BULLET.exec(text) ?? /^\s*(?:[-*]\s+)?/.exec(text))?.[0] ?? "";
  const value = text.slice(head.length).trimStart();
  if (!value.startsWith("{") && !value.startsWith("[")) return null;
  // Markdown checkboxes and links start with `[` too; keep normal prose truncation for them.
  if (/^\[[ xX]\](\s|$)|^\[[^\]\n]*\]\(/.test(value)) return null;
  return { prefix: head.trimEnd(), value };
}

/** Top-level entry count of a (possibly malformed) JSON array or object. */
function countJsonEntries(value: string): number {
  let depth = 0;
  let entries = 0;
  let inString = false;
  let seenValue = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] ?? "";
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) break;
    } else if (ch === "," && depth === 1) {
      entries += 1;
      seenValue = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (depth >= 1 && ch.trim()) seenValue = true;
  }
  return entries + (seenValue ? 1 : 0);
}

function jsonMarker(entries: number): string {
  return `(JSON, ${entries} ${entries === 1 ? "entry" : "entries"}; read HANDOFF)`;
}

/**
 * Last resort after the prose pass: truncate the longest machine lines until
 * the joined excerpt fits, never below the per-line floor.
 */
function capMachineLines(
  items: Entry[],
  maxBytes: number,
  floor: number,
  join: (items: Entry[]) => string,
): { items: Entry[]; machineTruncated: number } {
  const out = [...items];
  const touched = new Set<number>();
  let over = byteLength(join(out)) - maxBytes;
  while (over > 0) {
    let idx = -1;
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      if (e?.kind === "machine" && (idx < 0 || e.bytes > (out[idx]?.bytes ?? 0))) idx = i;
    }
    const e = out[idx];
    if (!e || e.bytes <= floor) break;
    const target = Math.max(floor, e.bytes - over);
    const { kept, removedChars } = truncateToBytes(e.text, target - MARKER_RESERVE_BYTES);
    const text = kept + truncationMarker(removedChars);
    const bytes = byteLength(text);
    if (bytes >= e.bytes) break;
    out[idx] = { text, kind: e.kind, bytes };
    touched.add(idx);
    over = byteLength(join(out)) - maxBytes;
  }
  return { items: out, machineTruncated: touched.size };
}

function droppedMarker(dropped: number): string {
  return `…[${dropped} prose ${dropped === 1 ? "line" : "lines"} omitted by the excerpt byte cap; read .cursor/HANDOFF.md]`;
}

/**
 * Equal share per prose line, water-filled: lines shorter than the share keep
 * their length and donate the difference to the longer ones.
 */
function proseShare(proseBytes: number[], budget: number, floor: number): number {
  const n = proseBytes.length;
  if (n === 0) return budget;
  let share = Math.floor(budget / n);
  for (let i = 0; i < 8; i++) {
    const longer = proseBytes.filter((b) => b > share);
    if (longer.length === 0) break;
    const used = proseBytes.reduce((sum, b) => sum + Math.min(b, share), 0);
    const slack = budget - used;
    const step = Math.floor(slack / longer.length);
    if (step <= 0) break;
    share += step;
  }
  return Math.max(floor, share);
}

export function capHandoffExcerpt(
  content: string,
  options: HandoffExcerptOptions = {},
): HandoffExcerptResult {
  const maxLines = options.maxLines ?? HANDOFF_EXCERPT_MAX_LINES;
  const maxBytes = options.maxBytes ?? HANDOFF_EXCERPT_MAX_BYTES;
  const floor = options.proseLineMinBytes ?? HANDOFF_PROSE_LINE_MIN_BYTES;

  const allEntries = classify(content.split(/\r?\n/));
  const entries = selectByFieldPriority(allEntries, maxLines);
  const join = (items: Entry[]) =>
    items
      .map((e) => e.text)
      .join("\n")
      .trim();

  const untouched = join(entries);
  const untouchedBytes = byteLength(untouched);
  if (untouchedBytes <= maxBytes) {
    return {
      text: untouched,
      bytes: untouchedBytes,
      lines: entries.length,
      truncatedLines: 0,
      droppedLines: 0,
      machineTruncated: 0,
    };
  }

  // Newlines count once per line; machine and structural lines are fixed cost.
  const fixedBytes = entries.reduce((sum, e) => sum + (e.kind === "prose" ? 0 : e.bytes) + 1, 0);
  const proseBudget = Math.max(0, maxBytes - fixedBytes);
  const share = proseShare(
    entries.filter((e) => e.kind === "prose").map((e) => e.bytes),
    proseBudget,
    floor,
  );

  let truncatedLines = 0;
  const shaped: Entry[] = entries.map((e) => {
    if (e.kind !== "prose" || e.bytes <= share) return e;
    const json = jsonValue(e.text);
    if (json) {
      const marker = jsonMarker(countJsonEntries(json.value));
      const text = json.prefix ? `${json.prefix} ${marker}` : marker;
      truncatedLines += 1;
      return { text, kind: e.kind, bytes: byteLength(text) };
    }
    const { kept, removedChars } = truncateToBytes(e.text, share - MARKER_RESERVE_BYTES);
    const text = kept + truncationMarker(removedChars);
    truncatedLines += 1;
    return { text, kind: e.kind, bytes: byteLength(text) };
  });

  let total = shaped.reduce((sum, e) => sum + e.bytes + 1, 0) - 1;
  let droppedLines = 0;
  if (total > maxBytes) {
    // Floor did not fit: drop prose lines last-first, keeping room for the note.
    const keep = new Set(shaped.map((_, i) => i));
    const noteBytes = byteLength(droppedMarker(99)) + 1;
    for (let i = shaped.length - 1; i >= 0 && total + noteBytes > maxBytes; i--) {
      const e = shaped[i];
      if (!e || e.kind !== "prose") continue;
      keep.delete(i);
      total -= e.bytes + 1;
      droppedLines += 1;
    }
    const remaining = shaped.filter((_, i) => keep.has(i));
    remaining.push({ text: droppedMarker(droppedLines), kind: "structural", bytes: 0 });
    const capped = capMachineLines(remaining, maxBytes, floor, join);
    const text = join(capped.items);
    return {
      text,
      bytes: byteLength(text),
      lines: entries.length,
      truncatedLines,
      droppedLines,
      machineTruncated: capped.machineTruncated,
    };
  }

  const capped = capMachineLines(shaped, maxBytes, floor, join);
  const text = join(capped.items);
  return {
    text,
    bytes: byteLength(text),
    lines: entries.length,
    truncatedLines,
    droppedLines,
    machineTruncated: capped.machineTruncated,
  };
}
