import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_SHIPPED_OVERLAY_HASHES } from "./overlay-known-hashes.js";
import { contentHash } from "./overlay.js";
import {
  appendHashes,
  collectExpectedHashes,
  parseKnownHashes,
  refreshKnownHashes,
} from "./refresh-known-hashes.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const hashA = contentHash("body a\n");
const hashB = contentHash("body b\n");
const hashOutOfOrder = contentHash("out of order body\n");
const hashNew = contentHash("brand new body\n");

const FIXTURE = `/**
 * Fixture mirror of overlay-known-hashes.ts.
 */
export const KNOWN_SHIPPED_OVERLAY_HASHES: ReadonlySet<string> = new Set([
  "${hashA}",
  "${hashOutOfOrder}", // intentionally out-of-order entry with inline comment
  "${hashB}",
]);
`;

async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-kit-known-hashes-"));
  const file = path.join(dir, "overlay-known-hashes.ts");
  await writeFile(file, FIXTURE, "utf8");
  return file;
}

describe("refresh-known-hashes helper", () => {
  it("appendHashes is purely additive: existing entries, order, and comments survive", () => {
    const next = appendHashes(FIXTURE, [hashNew]);
    // Everything before the closing `]);` is byte-identical.
    const marker = FIXTURE.lastIndexOf("]);");
    expect(next.startsWith(FIXTURE.slice(0, marker))).toBe(true);
    expect(next.endsWith(FIXTURE.slice(marker))).toBe(true);
    // Inline comment on the out-of-order entry is intact.
    expect(next).toContain("// intentionally out-of-order entry with inline comment");
    // Original relative order preserved (out-of-order entry stays where it was).
    expect(next.indexOf(hashA)).toBeLessThan(next.indexOf(hashOutOfOrder));
    expect(next.indexOf(hashOutOfOrder)).toBeLessThan(next.indexOf(hashB));
    // New hash lands after all existing entries.
    expect(next.indexOf(hashNew)).toBeGreaterThan(next.indexOf(hashB));
    expect(parseKnownHashes(next)).toEqual(new Set([hashA, hashOutOfOrder, hashB, hashNew]));
  });

  it("refresh appends a missing body hash and keeps every existing entry", async () => {
    const file = await makeFixture();
    const expected = [
      { source: ".cursor/commands/a.md", hash: hashA },
      { source: ".cursor/commands/new.md", hash: hashNew },
    ];
    const result = await refreshKnownHashes({ kitRoot, knownHashesPath: file, expected });
    expect(result.wrote).toBe(true);
    expect(result.missing).toEqual([{ source: ".cursor/commands/new.md", hash: hashNew }]);
    const written = await readFile(file, "utf8");
    expect(parseKnownHashes(written)).toEqual(new Set([hashA, hashOutOfOrder, hashB, hashNew]));
    // Append-only: the original body up to the closing marker is untouched.
    expect(written.startsWith(FIXTURE.slice(0, FIXTURE.lastIndexOf("]);")))).toBe(true);
  });

  it("deduplicates identical bodies: one hash appended for two sources", async () => {
    const file = await makeFixture();
    const expected = [
      { source: ".cursor/commands/x.md", hash: hashNew },
      { source: ".cursor/agents/y.md", hash: hashNew },
    ];
    const result = await refreshKnownHashes({ kitRoot, knownHashesPath: file, expected });
    expect(result.wrote).toBe(true);
    expect(result.missing).toHaveLength(2);
    const written = await readFile(file, "utf8");
    const occurrences = written.split(hashNew).length - 1;
    expect(occurrences).toBe(1);
  });

  it("check mode reports missing hashes without writing", async () => {
    const file = await makeFixture();
    const expected = [{ source: ".cursor/commands/new.md", hash: hashNew }];
    const result = await refreshKnownHashes({
      kitRoot,
      knownHashesPath: file,
      expected,
      check: true,
    });
    expect(result.wrote).toBe(false);
    expect(result.missing).toEqual(expected);
    expect(await readFile(file, "utf8")).toBe(FIXTURE);
  });

  it("is idempotent: second run is a no-op", async () => {
    const file = await makeFixture();
    const expected = [{ source: ".cursor/commands/new.md", hash: hashNew }];
    const first = await refreshKnownHashes({ kitRoot, knownHashesPath: file, expected });
    expect(first.wrote).toBe(true);
    const afterFirst = await readFile(file, "utf8");
    const second = await refreshKnownHashes({ kitRoot, knownHashesPath: file, expected });
    expect(second.wrote).toBe(false);
    expect(second.missing).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(afterFirst);
  });

  it("refuses to edit a file without the closing `]);` marker", () => {
    expect(() => appendHashes("export const X = 1;\n", [hashNew])).toThrow(/refusing to edit/);
  });

  it("enumerates the same sources as the coverage tests and matches the shipped set", async () => {
    const expected = await collectExpectedHashes(kitRoot);
    expect(expected.length).toBeGreaterThan(0);
    // L0 overlay artifacts and registry skills are both represented.
    expect(expected.some((e) => e.source.startsWith(".cursor/commands/"))).toBe(true);
    expect(expected.some((e) => e.source.endsWith("/SKILL.md"))).toBe(true);
    for (const e of expected) {
      expect(KNOWN_SHIPPED_OVERLAY_HASHES.has(e.hash), `missing ${e.source}`).toBe(true);
    }
  });
});
