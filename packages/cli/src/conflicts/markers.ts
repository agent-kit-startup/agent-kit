/**
 * Conflict-marker parser for `agent-kit conflicts` (ADR
 * 2026-10-23_git-cicd-tab-read-in-mc-act-in-colony.md, amend 2026-11-07).
 *
 * Reads a working-tree file that git left with conflict markers and splits it
 * into plain text and hunks (ours, optional base, theirs). Markers are git's
 * default size (7): a longer run, as a recursive merge writes into its virtual
 * base, is content. Line endings are kept byte for byte inside every segment.
 */

export const CONFLICT_MARKER_SIZE = 7;

export interface ConflictHunk {
  /** 1-based position of the hunk in the file. */
  index: number;
  /** 1-based line of the opening marker. */
  startLine: number;
  /** 1-based line of the closing marker. */
  endLine: number;
  ours: string;
  /** The base side: present only with diff3 / zdiff3 markers (or filled from the index). */
  base: string | null;
  theirs: string;
  oursLabel: string;
  baseLabel: string | null;
  theirsLabel: string;
}

export type ConflictSegment =
  | { kind: "text"; text: string }
  | { kind: "hunk"; hunk: ConflictHunk; raw: string };

export interface ParsedConflictFile {
  /** The dominant line ending (CRLF when most lines end with it). */
  eol: "\n" | "\r\n";
  /** False when the last line has no line ending. */
  finalNewline: boolean;
  segments: ConflictSegment[];
  hunks: ConflictHunk[];
}

export type ParseConflictResult =
  | { ok: true; file: ParsedConflictFile }
  | { ok: false; reason: string };

type MarkerKind = "open" | "base" | "sep" | "close";

const MARKER_CHAR: Record<MarkerKind, string> = { open: "<", base: "|", sep: "=", close: ">" };

/** Split keeping each line's terminator. */
export function splitLinesKeep(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function stripEol(line: string): string {
  return line.replace(/\r?\n$/, "");
}

/** Marker kind of one line (no terminator), or null. A separator carries no label. */
function markerKind(content: string, size: number): { kind: MarkerKind; label: string } | null {
  for (const kind of ["open", "base", "sep", "close"] as const) {
    const run = MARKER_CHAR[kind].repeat(size);
    if (!content.startsWith(run)) continue;
    const rest = content.slice(size);
    if (kind === "sep") return rest.trim() === "" ? { kind, label: "" } : null;
    if (rest === "") return { kind, label: "" };
    if (rest.startsWith(" ")) return { kind, label: rest.slice(1) };
    return null;
  }
  return null;
}

/** Every line of `text` that is a conflict marker of git's size (used to refuse leftovers). */
export function findMarkerLines(text: string, size = CONFLICT_MARKER_SIZE): string[] {
  return splitLinesKeep(text)
    .map(stripEol)
    .filter((line) => markerKind(line, size) !== null);
}

export function parseConflictText(text: string, size = CONFLICT_MARKER_SIZE): ParseConflictResult {
  if (text.includes("\u0000")) {
    return { ok: false, reason: "binary file (NUL byte); resolve it by hand" };
  }
  const lines = splitLinesKeep(text);
  const crlf = lines.filter((l) => l.endsWith("\r\n")).length;
  const lf = lines.filter((l) => l.endsWith("\n") && !l.endsWith("\r\n")).length;
  const segments: ConflictSegment[] = [];
  const hunks: ConflictHunk[] = [];
  let plain = "";
  let state: "out" | "ours" | "base" | "theirs" = "out";
  let cur: {
    startLine: number;
    raw: string;
    ours: string;
    base: string | null;
    theirs: string;
    oursLabel: string;
    baseLabel: string | null;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;
    const marker = markerKind(stripEol(line), size);
    if (state === "out") {
      if (marker?.kind === "open") {
        if (plain) segments.push({ kind: "text", text: plain });
        plain = "";
        cur = {
          startLine: lineNo,
          raw: line,
          ours: "",
          base: null,
          theirs: "",
          oursLabel: marker.label,
          baseLabel: null,
        };
        state = "ours";
      } else {
        // A separator, base or closing line outside a hunk is content
        // (a Markdown setext heading is a row of `=`).
        plain += line;
      }
      continue;
    }
    if (!cur) return { ok: false, reason: "internal parser state" };
    cur.raw += line;
    if (marker?.kind === "open") {
      return { ok: false, reason: `nested conflict marker at line ${lineNo}` };
    }
    if (state === "ours") {
      if (marker?.kind === "base") {
        cur.base = "";
        cur.baseLabel = marker.label;
        state = "base";
      } else if (marker?.kind === "sep") {
        state = "theirs";
      } else if (marker?.kind === "close") {
        return { ok: false, reason: `closing marker before the separator at line ${lineNo}` };
      } else {
        cur.ours += line;
      }
      continue;
    }
    if (state === "base") {
      if (marker?.kind === "sep") {
        state = "theirs";
      } else if (marker) {
        return { ok: false, reason: `unexpected marker in the base section at line ${lineNo}` };
      } else {
        cur.base = (cur.base ?? "") + line;
      }
      continue;
    }
    // theirs
    if (marker?.kind === "close") {
      const hunk: ConflictHunk = {
        index: hunks.length + 1,
        startLine: cur.startLine,
        endLine: lineNo,
        ours: cur.ours,
        base: cur.base,
        theirs: cur.theirs,
        oursLabel: cur.oursLabel,
        baseLabel: cur.baseLabel,
        theirsLabel: marker.label,
      };
      hunks.push(hunk);
      segments.push({ kind: "hunk", hunk, raw: cur.raw });
      cur = null;
      state = "out";
    } else if (marker) {
      return { ok: false, reason: `unexpected marker in the theirs section at line ${lineNo}` };
    } else {
      cur.theirs += line;
    }
  }
  if (state !== "out") {
    return { ok: false, reason: `unterminated conflict hunk opened at line ${cur?.startLine}` };
  }
  if (plain) segments.push({ kind: "text", text: plain });
  return {
    ok: true,
    file: {
      eol: crlf > lf ? "\r\n" : "\n",
      finalNewline: text.length === 0 || text.endsWith("\n"),
      segments,
      hunks,
    },
  };
}
