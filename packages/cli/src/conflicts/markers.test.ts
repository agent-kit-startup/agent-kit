import { describe, expect, it } from "vitest";
import { findMarkerLines, parseConflictText } from "./markers.js";

const two = [
  "keep\n",
  "<<<<<<< HEAD\n",
  "ours line\n",
  "=======\n",
  "theirs line\n",
  ">>>>>>> feature\n",
  "tail\n",
].join("");

const three = [
  "keep\n",
  "<<<<<<< HEAD\n",
  "ours line\n",
  "||||||| base-sha\n",
  "base line\n",
  "=======\n",
  "theirs line\n",
  ">>>>>>> feature\n",
  "tail\n",
].join("");

describe("parseConflictText", () => {
  it("parses a two-way hunk with no base", () => {
    const r = parseConflictText(two);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.hunks).toHaveLength(1);
    const h = r.file.hunks[0];
    expect(h).toMatchObject({
      index: 1,
      startLine: 2,
      endLine: 6,
      ours: "ours line\n",
      base: null,
      theirs: "theirs line\n",
      oursLabel: "HEAD",
      theirsLabel: "feature",
    });
    expect(r.file.segments.map((s) => s.kind)).toEqual(["text", "hunk", "text"]);
  });

  it("parses a diff3 hunk with its base", () => {
    const r = parseConflictText(three);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.hunks[0]).toMatchObject({ base: "base line\n", baseLabel: "base-sha" });
  });

  it("keeps CRLF line endings inside each side and reports the file's EOL", () => {
    const r = parseConflictText(three.replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.eol).toBe("\r\n");
    expect(r.file.hunks[0]?.ours).toBe("ours line\r\n");
    expect(r.file.hunks[0]?.theirsLabel).toBe("feature");
  });

  it("parses a hunk closed on the last line with no newline at EOF", () => {
    const text = "a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feature";
    const r = parseConflictText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.finalNewline).toBe(false);
    expect(r.file.hunks[0]?.theirs).toBe("y\n");
    const last = r.file.segments.at(-1);
    expect(last?.kind).toBe("hunk");
    if (last?.kind === "hunk") expect(last.raw.endsWith(">>>>>>> feature")).toBe(true);
  });

  it("reads longer markers from a recursive merge's virtual base as content", () => {
    const text = [
      "<<<<<<< HEAD\n",
      "ours\n",
      "||||||| merged common ancestors\n",
      "<<<<<<<<< Temporary merge branch 1\n",
      "b1\n",
      "=========\n",
      "b2\n",
      ">>>>>>>>> Temporary merge branch 2\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> feature\n",
    ].join("");
    const r = parseConflictText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.hunks).toHaveLength(1);
    expect(r.file.hunks[0]?.base).toContain("<<<<<<<<< Temporary merge branch 1\n");
  });

  it("refuses nested markers of the same size", () => {
    const text = "<<<<<<< HEAD\nx\n<<<<<<< HEAD\ny\n=======\nz\n>>>>>>> f\n";
    const r = parseConflictText(text);
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/nested/) });
  });

  it("refuses an unterminated hunk and a closing marker before the separator", () => {
    expect(parseConflictText("<<<<<<< HEAD\nx\n=======\ny\n").ok).toBe(false);
    expect(parseConflictText("<<<<<<< HEAD\nx\n>>>>>>> f\n").ok).toBe(false);
  });

  it("refuses a binary file", () => {
    const r = parseConflictText("a\u0000b\n");
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/binary/) });
  });

  it("reports zero hunks for a resolved file, and keeps a setext heading as content", () => {
    const r = parseConflictText("Title\n=======\n\ntext\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.hunks).toHaveLength(0);
  });

  it("numbers several hunks from 1 and keeps the text between them", () => {
    const r = parseConflictText(`${two}middle\n${three}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.hunks.map((h) => h.index)).toEqual([1, 2]);
    expect(r.file.hunks[1]?.startLine).toBe(10);
  });
});

describe("findMarkerLines", () => {
  it("finds every conflict marker line, including a bare separator", () => {
    expect(findMarkerLines("ok\n<<<<<<< a\n")).toEqual(["<<<<<<< a"]);
    expect(findMarkerLines("x\n=======\n")).toEqual(["======="]);
    expect(findMarkerLines("|||||||\r\n>>>>>>> b")).toEqual(["|||||||", ">>>>>>> b"]);
    expect(findMarkerLines("a <<<<<<< b\n========\n")).toEqual([]);
  });
});
