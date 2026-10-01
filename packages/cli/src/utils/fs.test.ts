import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, writeJson } from "./fs.js";

describe("writeJson", () => {
  it("replaces the file atomically and leaves no temp file behind", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-kit-fs-"));
    const target = path.join(dir, "nested", "config.json");
    await writeJson(target, { a: 1 });
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJson(target, { a: i })));
    const parsed = await readJson<{ a: number }>(target);
    expect(typeof parsed?.a).toBe("number");
    expect((await readFile(target, "utf8")).endsWith("}\n")).toBe(true);
    expect(await readdir(path.dirname(target))).toEqual(["config.json"]);
  });
});
