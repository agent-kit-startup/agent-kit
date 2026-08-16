import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentKitManifest } from "../manifest/types.js";
import { buildRegistryPathMap, planContribute } from "./contribute.js";

/** Registry with one community skill that ships a companion file. */
async function fixtureRegistry(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-kit-contribute-registry-"));
  const skillDir = path.join(root, "registry/skills/community/demo");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), "# Demo\n");
  await writeFile(path.join(skillDir, "checklist.md"), "# Checklist\n");
  await writeFile(
    path.join(root, "registry/registry.json"),
    JSON.stringify({
      skills: { core: [], community: [{ id: "demo", path: "registry/skills/community/demo" }] },
    }),
  );
  return root;
}

const manifest = { schemaVersion: 1, skills: ["demo"] } as unknown as AgentKitManifest;

describe("buildRegistryPathMap", () => {
  it("maps a skill's companion files, not only SKILL.md", async () => {
    const registryRoot = await fixtureRegistry();
    const map = await buildRegistryPathMap(registryRoot, manifest);
    expect(map.get(".cursor/skills/community/demo/SKILL.md")).toBe(
      "registry/skills/community/demo/SKILL.md",
    );
    expect(map.get(".cursor/skills/community/demo/checklist.md")).toBe(
      "registry/skills/community/demo/checklist.md",
    );
  });
});

describe("planContribute path mapping", () => {
  it("maps a brand-new companion file under an installed skill", async () => {
    const registryRoot = await fixtureRegistry();
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-contribute-project-"));
    const skillDir = path.join(project, ".cursor/skills/community/demo/references");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "deep.md"), "# Deep reference\n");

    const plan = await planContribute({
      registryRoot,
      projectRoot: project,
      manifest,
      extraPaths: [".cursor/skills/community/demo/references/deep.md"],
      includeDrift: false,
    });

    const candidate = plan.candidates.find(
      (c) => c.projectPath === ".cursor/skills/community/demo/references/deep.md",
    );
    expect(candidate?.registryPath).toBe("registry/skills/community/demo/references/deep.md");
    expect(candidate?.issues.map((i) => i.code)).not.toContain("unmapped");
  });

  it("keeps the legacy flat skill layout mapping to community", async () => {
    const registryRoot = await fixtureRegistry();
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-contribute-flat-"));
    const skillDir = path.join(project, ".cursor/skills/legacy");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# Legacy\n");

    const plan = await planContribute({
      registryRoot,
      projectRoot: project,
      manifest,
      extraPaths: [".cursor/skills/legacy/SKILL.md"],
      includeDrift: false,
    });

    expect(
      plan.candidates.find((c) => c.projectPath === ".cursor/skills/legacy/SKILL.md")?.registryPath,
    ).toBe("registry/skills/community/legacy/SKILL.md");
  });
});
