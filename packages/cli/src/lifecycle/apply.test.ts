import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROTECTED_PATHS } from "../manifest/types.js";
import { copyRegistryFile } from "./apply.js";
import { installL0 } from "./sync.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("lifecycle apply L3", () => {
  it("skips writing into protected L3 paths", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l3-"));
    await mkdir(path.join(project, ".cursor"), { recursive: true });
    await writeFile(path.join(project, ".cursor", "HANDOFF.md"), "local handoff\n", "utf8");

    const outcome = await copyRegistryFile(
      kitRoot,
      project,
      ".cursor/rules/ux-tone.mdc",
      ".cursor/HANDOFF.md",
      [...DEFAULT_PROTECTED_PATHS],
    );
    expect(outcome).toBe("skipped-protected");
    expect(await readFile(path.join(project, ".cursor", "HANDOFF.md"), "utf8")).toBe(
      "local handoff\n",
    );
  });

  it("installL0 writes core rules from the kit registry", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-"));
    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(stats.written.some((p) => p.includes(".cursor/rules/"))).toBe(true);
    expect(stats.written.some((p) => p.includes(".cursor/commands/"))).toBe(true);
    expect(stats.written.some((p) => p === "autogit/gitupdate.md")).toBe(true);
    expect(stats.written.some((p) => p === "autogit/plan-routine.md")).toBe(true);
  });

  it("installL0 writes external-review templates (not L3-blocked)", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-l0-tpl-"));
    const stats = await installL0(kitRoot, project, [...DEFAULT_PROTECTED_PATHS]);
    expect(
      stats.written.some((p) => p === ".cursor/context/templates/plan-external-review-prompt.md"),
    ).toBe(true);
    expect(stats.written.some((p) => p === ".cursor/context/config.example.json")).toBe(true);
    expect(stats.skippedProtected).not.toContain(
      ".cursor/context/templates/plan-external-review-prompt.md",
    );
  });

  it("copyRegistryFile reports unchanged when content matches", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-unchanged-"));
    const rel = ".cursor/rules/ux-tone.mdc";
    const outcome1 = await copyRegistryFile(kitRoot, project, rel, rel, []);
    expect(outcome1).toBe("written");
    const outcome2 = await copyRegistryFile(kitRoot, project, rel, rel, []);
    expect(outcome2).toBe("unchanged");
  });
});
