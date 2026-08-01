import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_TERMINAL_BYTES,
  buildTerminalSnapshotFields,
  parseTerminalMeta,
  splitTerminalHeader,
} from "../../../../dashboard/lib/terminal-snapshot.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");

function makeOverCapTerminal(bodyPadBytes) {
  const header = [
    "---",
    "pid: 424242",
    "cwd: /Users/macos/Documents/Git/agent-kit",
    "last_command: pnpm test",
    "last_exit_code: 0",
    "---",
    "",
  ].join("\n");
  // Short lines so the last-output char cap still keeps the fresh tail marker.
  const padLine = "pad";
  const linesNeeded = Math.ceil(bodyPadBytes / (padLine.length + 1));
  const body = Array.from({ length: linesNeeded }, (_, i) => `line-${i} ${padLine}`).join("\n");
  const tailMarker = "FRESH_TAIL_OUTPUT_MARKER";
  return `${header}${body}\n${tailMarker}\n`;
}

describe("terminal-snapshot: head meta + tail body", () => {
  it("parses meta from the file head even when the body exceeds MAX_TERMINAL_BYTES", () => {
    const raw = makeOverCapTerminal(MAX_TERMINAL_BYTES + 8_000);
    expect(raw.length).toBeGreaterThan(MAX_TERMINAL_BYTES);

    const { meta, lastOutput, outputLines } = buildTerminalSnapshotFields(raw, {
      maxBytes: MAX_TERMINAL_BYTES,
    });

    expect(meta.pid).toBe("424242");
    expect(meta.cwd).toBe("/Users/macos/Documents/Git/agent-kit");
    expect(meta.lastCommand).toBe("pnpm test");
    expect(meta.lastExitCode).toBe("0");
    expect(outputLines).toBeGreaterThan(0);
    expect(lastOutput).toContain("FRESH_TAIL_OUTPUT_MARKER");
  });

  it("keeps meta when a plain tail-slice would have dropped the header", () => {
    const raw = makeOverCapTerminal(MAX_TERMINAL_BYTES + 4_000);
    const naiveTail = raw.slice(-MAX_TERMINAL_BYTES);
    const naiveMeta = parseTerminalMeta(naiveTail.split("\n").slice(0, 15));
    expect(naiveMeta.pid).toBeUndefined();
    expect(naiveMeta.lastExitCode).toBeUndefined();

    const { meta } = buildTerminalSnapshotFields(raw);
    expect(meta.pid).toBe("424242");
    expect(meta.lastExitCode).toBe("0");
  });

  it("splits header after the second ---", () => {
    const raw = "---\npid: 1\ncwd: /tmp\n---\nhello\n";
    const { headerLines, bodyLines } = splitTerminalHeader(raw);
    expect(headerLines.join("\n")).toContain("pid: 1");
    expect(bodyLines.join("\n")).toContain("hello");
  });

  it("uses TERMINAL_HEAD_META_BYTES head window on oversized files (T7/T8)", () => {
    const raw = makeOverCapTerminal(MAX_TERMINAL_BYTES + 200_000);
    expect(raw.length).toBeGreaterThan(MAX_TERMINAL_BYTES + 4096);

    const { meta, lastOutput } = buildTerminalSnapshotFields(raw, {
      maxBytes: MAX_TERMINAL_BYTES,
      headMetaBytes: 4096,
    });

    expect(meta.pid).toBe("424242");
    expect(lastOutput).toContain("FRESH_TAIL_OUTPUT_MARKER");
  });

  it("trims partial first body line on windowed over-cap path (U4)", () => {
    const header = ["---", "pid: 99", "cwd: /tmp", "---", ""].join("\n");
    const maxBytes = 200;
    const headMetaBytes = 64;
    const longLine = `PARTIAL${"X".repeat(300)}COMPLETE`;
    const suffix = "\nTAIL_OK\n";
    const pad = "p\n".repeat(5000);
    const raw = `${header}${pad}${longLine}${suffix}`;
    expect(raw.length).toBeGreaterThan(headMetaBytes + maxBytes);
    const sliceStart = raw.length - maxBytes;
    const longStart = raw.indexOf(longLine);
    expect(sliceStart).toBeGreaterThan(longStart);
    expect(sliceStart).toBeLessThan(longStart + longLine.length);

    const naiveTail = raw.slice(-maxBytes);
    const cut = naiveTail.indexOf("\n");
    expect(cut).toBeGreaterThan(0);
    const partialFirst = naiveTail.slice(0, cut);
    expect(partialFirst.length).toBeGreaterThan(0);
    expect(partialFirst).not.toBe(longLine);

    const { bodyLines, lastOutput, meta } = buildTerminalSnapshotFields(raw, {
      maxBytes,
      headMetaBytes,
    });
    expect(meta.pid).toBe("99");
    expect(lastOutput).toContain("TAIL_OK");
    expect(bodyLines.some((l) => l === partialFirst)).toBe(false);
    expect(bodyLines[0]).not.toBe(partialFirst);
  });
});

describe("dashboard-data wires terminal-snapshot lib", () => {
  it("imports buildTerminalSnapshotFields and does not parse meta from a tail-only content slice", () => {
    expect(dataSource).toMatch(/from ['"]\.\/lib\/terminal-snapshot\.mjs['"]/);
    expect(dataSource).toContain("buildTerminalSnapshotFields");
    expect(dataSource).not.toMatch(
      /const content = raw\.length > MAX_TERMINAL_BYTES \? raw\.slice\(-MAX_TERMINAL_BYTES\)/,
    );
  });
});
