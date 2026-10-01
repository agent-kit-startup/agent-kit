import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentKitManifest } from "../manifest/types.js";
import { allSkills, loadRegistry } from "../registry/client.js";
import { loadPackManifest, packMemberTargets, skillFileTargets } from "../registry/install.js";
import { buildRegistryPathMap } from "./contribute.js";
import { diffAgainstRegistry } from "./diff.js";
import { L0_ARTIFACTS } from "./l0.js";
import { managedPairs } from "./targets.js";

/** Registry with a pack (rule + skill member with a companion) and a standalone skill. */
async function fixtureRegistry(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "agent-kit-targets-registry-"));
  const packSkill = path.join(root, "registry/skills/community/pack-skill");
  await mkdir(path.join(packSkill, "references"), { recursive: true });
  await writeFile(path.join(packSkill, "SKILL.md"), "# Pack skill\n");
  await writeFile(path.join(packSkill, "references/deep.md"), "# Deep\n");
  const solo = path.join(root, "registry/skills/core/solo");
  await mkdir(solo, { recursive: true });
  await writeFile(path.join(solo, "SKILL.md"), "# Solo\n");
  await writeFile(path.join(solo, "checklist.md"), "# Checklist\n");
  await mkdir(path.join(root, "registry/packs/demo"), { recursive: true });
  await writeFile(
    path.join(root, "registry/packs/demo/pack.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "demo",
      title: "Demo",
      description: "Fixture pack.",
      version: "0.1.0",
      members: [
        { kind: "rule", id: "demo-rule", source: ".cursor/rules/demo-rule.mdc" },
        { kind: "skill", id: "pack-skill", source: "registry/skills/community/pack-skill" },
      ],
    }),
  );
  await writeFile(
    path.join(root, "registry/registry.json"),
    JSON.stringify({
      skills: {
        core: [{ id: "solo", path: "registry/skills/core/solo" }],
        community: [{ id: "pack-skill", path: "registry/skills/community/pack-skill" }],
      },
      packs: [
        {
          id: "demo",
          title: "Demo",
          description: "Fixture pack.",
          version: "0.1.0",
          path: "registry/packs/demo",
        },
      ],
    }),
  );
  return root;
}

const manifest = {
  schemaVersion: 1,
  packs: ["demo"],
  skills: ["solo", "ghost"],
} as unknown as AgentKitManifest;

/** The enumeration diff.ts and contribute.ts each inlined before managedPairs. */
async function legacyPairs(
  registryRoot: string,
): Promise<{ sourceRel: string; targetRel: string }[]> {
  const pairs: { sourceRel: string; targetRel: string }[] = [];
  for (const a of L0_ARTIFACTS) pairs.push({ sourceRel: a.source, targetRel: a.target });
  for (const packId of manifest.packs ?? []) {
    const pack = await loadPackManifest(registryRoot, packId);
    for (const member of pack.members) {
      pairs.push(
        ...(member.kind === "skill"
          ? await skillFileTargets(registryRoot, member.source, member.id)
          : [packMemberTargets(member)]),
      );
    }
  }
  const pool = allSkills(await loadRegistry(registryRoot));
  for (const id of manifest.skills ?? []) {
    const skill = pool.find((s) => s.id === id);
    if (!skill) continue;
    pairs.push(...(await skillFileTargets(registryRoot, skill.path, skill.id)));
  }
  return pairs;
}

describe("managedPairs", () => {
  it("yields exactly the pairs diff and contribute enumerated before", async () => {
    const registryRoot = await fixtureRegistry();
    const legacy = await legacyPairs(registryRoot);
    const { pairs, missingSkills } = await managedPairs(registryRoot, manifest);

    expect(pairs.map(({ sourceRel, targetRel }) => ({ sourceRel, targetRel }))).toEqual(legacy);
    expect(missingSkills).toEqual(["ghost"]);
    expect(pairs.filter((p) => p.origin === "l0")).toHaveLength(L0_ARTIFACTS.length);
    expect(pairs.filter((p) => p.origin === "pack").map((p) => p.targetRel)).toEqual([
      ".cursor/rules/demo-rule.mdc",
      ".cursor/skills/community/pack-skill/SKILL.md",
      ".cursor/skills/community/pack-skill/references/deep.md",
    ]);
    expect(pairs.filter((p) => p.origin === "skill").map((p) => p.targetRel)).toEqual([
      ".cursor/skills/core/solo/SKILL.md",
      ".cursor/skills/core/solo/checklist.md",
    ]);

    const index = await loadRegistry(registryRoot);
    expect(await managedPairs(registryRoot, manifest, index)).toEqual({ pairs, missingSkills });
  });

  it("keeps diff and contribute on the same pairs", async () => {
    const registryRoot = await fixtureRegistry();
    const legacy = await legacyPairs(registryRoot);
    const project = await mkdtemp(path.join(tmpdir(), "agent-kit-targets-project-"));

    const map = await buildRegistryPathMap(registryRoot, manifest);
    expect(map).toEqual(new Map(legacy.map((p) => [p.targetRel, p.sourceRel])));

    const entries = await diffAgainstRegistry(registryRoot, project, manifest);
    const firstSeen = [...new Set(legacy.map((p) => p.targetRel))];
    expect(entries.map((e) => e.path)).toEqual([...firstSeen, "skill:ghost"]);
  });
});
