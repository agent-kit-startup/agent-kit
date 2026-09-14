import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("doctor runtime CLI warn", () => {
  it("wires warnIfRunningCliBehindNpm before the run and skips it on --json", async () => {
    const src = await readFile(new URL("./doctor.ts", import.meta.url), "utf8");
    expect(src).toMatch(/warnIfRunningCliBehindNpm/);
    expect(src).toMatch(/if \(!args\.json\)/);
  });
});
