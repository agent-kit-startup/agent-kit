/**
 * Terminal file parsing for Mission Control snapshots.
 * Header meta always comes from the file head; body/output may be tail-capped.
 *
 * Contract (U5): over-cap files parse meta from the first `TERMINAL_HEAD_META_BYTES`
 * (4096) only. If the second `---` falls past that window, `splitTerminalHeader`
 * falls back to `min(10, lines)` on the head slice — keep headers compact.
 */

export const MAX_TERMINAL_BYTES = 64 * 1024;
export const MAX_LAST_OUTPUT_LINES = 15;
export const MAX_LAST_OUTPUT_CHARS = 1200;
/** Enough bytes to cover the YAML-ish header even on noisy files. */
export const TERMINAL_HEAD_META_BYTES = 4096;

/**
 * Split a Cursor terminal dump into header lines (file start) and body lines.
 * Header ends after the second `---` line, or after 10 lines if missing.
 */
export function splitTerminalHeader(raw) {
  const text = String(raw ?? "");
  const lines = text.split("\n");
  let headerEnd = 0;
  let dashCount = 0;
  const scanLimit = Math.min(lines.length, 40);
  for (let i = 0; i < scanLimit; i++) {
    if (lines[i].trim() === "---") {
      dashCount++;
      if (dashCount === 2) {
        headerEnd = i + 1;
        break;
      }
    }
  }
  if (headerEnd === 0) headerEnd = Math.min(10, lines.length);
  return {
    headerLines: lines.slice(0, headerEnd),
    bodyLines: lines.slice(headerEnd),
    headerEnd,
  };
}

/** Parse pid/cwd/command/exit from header lines (or first 15 of a head slice). */
export function parseTerminalMeta(headerLines) {
  const meta = {};
  const lines = Array.isArray(headerLines) ? headerLines : String(headerLines ?? "").split("\n");
  for (const line of lines.slice(0, 15)) {
    if (line.startsWith("pid:")) meta.pid = line.slice(4).trim();
    if (line.startsWith("cwd:")) meta.cwd = line.slice(4).trim();
    if (line.startsWith("command:")) meta.lastCommand = line.slice(8).trim();
    if (line.startsWith("last_command:")) meta.lastCommand = line.slice(13).trim();
    if (line.startsWith("last_exit_code:")) meta.lastExitCode = line.slice(15).trim();
  }
  return meta;
}

/**
 * Tail-cap body lines by approximate UTF-16 byte budget so lastOutput stays fresh
 * without dropping the file-head meta.
 */
export function tailCapBodyLines(bodyLines, maxBytes = MAX_TERMINAL_BYTES) {
  const lines = Array.isArray(bodyLines) ? bodyLines : [];
  if (lines.length === 0) return [];
  const joined = lines.join("\n");
  if (joined.length <= maxBytes) return lines;
  const tail = joined.slice(-maxBytes);
  // Drop a partial first line after the byte cut.
  const cut = tail.indexOf("\n");
  const cleaned = cut >= 0 ? tail.slice(cut + 1) : tail;
  return cleaned.split("\n");
}

/**
 * Last N non-empty body lines, char-capped. Caller supplies already-capped body lines
 * and an optional redact(text) → text.
 */
export function extractLastOutputFromBody(bodyLines, options = {}) {
  const maxLines = options.maxLines ?? MAX_LAST_OUTPUT_LINES;
  const maxChars = options.maxChars ?? MAX_LAST_OUTPUT_CHARS;
  const redact = typeof options.redact === "function" ? options.redact : (t) => t;
  const truncate =
    typeof options.truncate === "function" ? options.truncate : (t, n) => String(t).slice(0, n);

  const filtered = bodyLines.filter((l) => l.trim() && !l.startsWith("---"));
  if (filtered.length === 0) return null;

  const tail = filtered.slice(-maxLines);
  let text = redact(tail.join("\n"));
  text = truncate(text, maxChars);
  return text?.trim() ? text : null;
}

/**
 * Build terminal snapshot fields from a raw terminal file.
 * Meta always from head; lastOutput/outputLines from tail-capped body.
 * Large files use a head window + tail window before any split/join so peak
 * memory stays ~head+tail instead of a full-file line array (T7/T8).
 */
export function buildTerminalSnapshotFields(raw, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_TERMINAL_BYTES;
  const headBytes = options.headMetaBytes ?? TERMINAL_HEAD_META_BYTES;
  const text = String(raw ?? "");

  let headerLines;
  let cappedBody;

  if (text.length <= headBytes + maxBytes) {
    const split = splitTerminalHeader(text);
    headerLines = split.headerLines;
    cappedBody = tailCapBodyLines(split.bodyLines, maxBytes);
  } else {
    const head = text.slice(0, headBytes);
    const split = splitTerminalHeader(head);
    headerLines = split.headerLines;
    // Windowed path: tail is exactly maxBytes, so tailCapBodyLines' `<= maxBytes`
    // short-circuit would skip the partial-first-line trim. Drop it here first (U4).
    const tail = text.slice(-maxBytes);
    const cut = tail.indexOf("\n");
    const cleaned = cut >= 0 ? tail.slice(cut + 1) : tail;
    cappedBody = cleaned.split("\n");
  }

  const meta = parseTerminalMeta(headerLines);
  const outputLines = cappedBody.filter((l) => l.trim() && !l.startsWith("---")).length;
  const lastOutput = extractLastOutputFromBody(cappedBody, options);
  return { meta, outputLines, lastOutput, headerLines, bodyLines: cappedBody };
}
