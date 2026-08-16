import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installSkill, skillFileTargets, skillTargetDir } from "./install.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Registry fixture: one skill with a companion file and a nested reference. */
async function fixtureRegistry(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-kit-skill-files-"));
  const skillDir = path.join(root, "registry/skills/community/demo");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), "# Demo\n\n[checklist](checklist.md)\n");
  await writeFile(path.join(skillDir, "checklist.md"), "# Checklist\n");
  await writeFile(path.join(skillDir, "references/deep.md"), "# Deep\n");
  await writeFile(path.join(skillDir, ".DS_Store"), "noise");
  return root;
}

describe("skillTargetDir", () => {
  it("routes core and community skills to their category folder", () => {
    expect(skillTargetDir("registry/skills/core/clean-code", "clean-code")).toBe(
      ".cursor/skills/core/clean-code",
    );
    expect(skillTargetDir("registry/skills/community/demo", "demo")).toBe(
      ".cursor/skills/community/demo",
    );
  });
});

describe("skillFileTargets", () => {
  it("lists SKILL.md first, then companions, including nested ones", async () => {
    const root = await fixtureRegistry();
    const targets = await skillFileTargets(root, "registry/skills/community/demo", "demo");
    expect(targets.map((t) => t.sourceRel)).toEqual([
      "registry/skills/community/demo/SKILL.md",
      "registry/skills/community/demo/checklist.md",
      "registry/skills/community/demo/references/deep.md",
    ]);
    expect(targets.map((t) => t.targetRel)).toEqual([
      ".cursor/skills/community/demo/SKILL.md",
      ".cursor/skills/community/demo/checklist.md",
      ".cursor/skills/community/demo/references/deep.md",
    ]);
  });

  it("falls back to the SKILL.md pair when the source directory is unreadable", async () => {
    const root = await fixtureRegistry();
    const targets = await skillFileTargets(root, "registry/skills/community/absent", "absent");
    expect(targets).toEqual([
      {
        sourceRel: "registry/skills/community/absent/SKILL.md",
        targetRel: ".cursor/skills/community/absent/SKILL.md",
      },
    ]);
  });

  it("keeps the real registry skill with a companion file whole", async () => {
    const targets = await skillFileTargets(
      kitRoot,
      "registry/skills/community/n8n-workflows",
      "n8n-workflows",
    );
    expect(targets.map((t) => t.targetRel)).toContain(
      ".cursor/skills/community/n8n-workflows/checklist-n8n.md",
    );
  });
});

describe("installSkill", () => {
  it("writes companion files into the consumer tree, not just SKILL.md", async () => {
    const registryRoot = await fixtureRegistry();
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-skill-project-"));

    const stats = await installSkill(registryRoot, project, {
      id: "demo",
      path: "registry/skills/community/demo",
    } as Parameters<typeof installSkill>[2]);

    expect(stats.written).toEqual([
      ".cursor/skills/community/demo/SKILL.md",
      ".cursor/skills/community/demo/checklist.md",
      ".cursor/skills/community/demo/references/deep.md",
    ]);
    expect(
      await readFile(path.join(project, ".cursor/skills/community/demo/checklist.md"), "utf8"),
    ).toBe("# Checklist\n");
  });
});
