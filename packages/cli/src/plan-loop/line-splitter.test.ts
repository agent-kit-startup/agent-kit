import { describe, expect, it, vi } from "vitest";
import { LineSplitter, PENDING_MAX_CHARS } from "./line-splitter.js";

function collect(splitter: LineSplitter, chunks: string[]): string[] {
  const out: string[] = [];
  for (const chunk of chunks) splitter.feed(chunk, (line) => out.push(line));
  return out;
}

describe("LineSplitter", () => {
  it("parses a 1MB line fed in 1KB chunks exactly once", () => {
    const line = "x".repeat(1024 * 1024);
    const text = `${line}\n`;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 1024) chunks.push(text.slice(i, i + 1024));
    const splitter = new LineSplitter();
    const onLine = vi.fn();
    for (const chunk of chunks) splitter.feed(chunk, onLine);
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine.mock.calls[0]?.[0]).toBe(line);
    expect(splitter.end()).toBe("");
  });

  it("drops an oversized held line, then resumes at the next newline", () => {
    const splitter = new LineSplitter(10);
    const lines = collect(splitter, ["ok\n", "0123456789", "ABCDEF", "tail\nnext\n", "held"]);
    expect(lines).toEqual(["ok", "next"]);
    expect(splitter.end()).toBe("held");
  });

  it("returns nothing from end() while dropping", () => {
    const splitter = new LineSplitter(4);
    expect(collect(splitter, ["123456"])).toEqual([]);
    expect(splitter.end()).toBe("");
    expect(collect(splitter, ["after\n"])).toEqual(["after"]);
  });

  it("keeps CR and empty lines as the split-based parsers did", () => {
    const splitter = new LineSplitter();
    expect(collect(splitter, ["a\r\n\n", "b", "\r\nc"])).toEqual(["a\r", "", "b\r"]);
    expect(splitter.end()).toBe("c");
  });

  it("defaults to the 4MB cap", () => {
    expect(PENDING_MAX_CHARS).toBe(4 * 1024 * 1024);
  });
});
