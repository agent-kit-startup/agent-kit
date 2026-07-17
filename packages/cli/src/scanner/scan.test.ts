import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runScanner } from "./scan.js";

describe("runScanner", () => {
  it("detects greenfield repo", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-greenfield-"));
    await writeFile(path.join(root, "README.md"), "# temp");
    const result = await runScanner(root);
    expect(result.isGreenfield).toBe(true);
  });

  it("detects existing node project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-existing-"));
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, "package.json"), "{}");
    const result = await runScanner(root);
    expect(result.isGreenfield).toBe(false);
    expect(result.stack.language).toBe("node");
  });
});
