import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allArtifacts, allPacks, loadRegistry, resolveAddTarget } from "./client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("registry v2", () => {
  it("loads packs and artifacts from registry.json", async () => {
    const index = await loadRegistry(root);
    expect(index.schemaVersion).toBe(2);
    expect(allPacks(index).map((p) => p.id)).toContain("cybersec");
    expect(allPacks(index).length).toBe(7);
    expect(
      allArtifacts(index).some((a) => a.kind === "agent" && a.id === "security-reviewer"),
    ).toBe(true);
  });

  it("resolveAddTarget finds skills and packs", async () => {
    const skill = await resolveAddTarget(root, "sql-postgres");
    expect(skill.type).toBe("skill");
    const pack = await resolveAddTarget(root, "devops");
    expect(pack.type).toBe("pack");
    if (pack.type === "pack") expect(pack.pack.id).toBe("devops");
  });

  it("resolveAddTarget errors on skill/pack id collision", async () => {
    await expect(resolveAddTarget(root, "clean-code")).rejects.toThrow(/both a skill and a pack/);
  });
});
