import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { L0_ARTIFACTS } from "../lifecycle/l0.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

/** Collect every `SKILL.md` under `.cursor/skills/` (core / community / domain). */
function listSkillMdFiles(skillsRoot: string): string[] {
  const out: string[] = [];
  for (const category of readdirSync(skillsRoot)) {
    const catPath = join(skillsRoot, category);
    if (!statSync(catPath).isDirectory()) continue;
    for (const id of readdirSync(catPath)) {
      const skillMd = join(catPath, id, "SKILL.md");
      try {
        if (statSync(skillMd).isFile()) {
          out.push(`.cursor/skills/${category}/${id}/SKILL.md`);
        }
      } catch {
        // no SKILL.md in this dir (procedure-only is fine)
      }
    }
  }
  return out.sort();
}

describe("capability-inventory skills counts", () => {
  it("pins SKILL.md on-disk count and required inventory rows", () => {
    const skillMd = listSkillMdFiles(join(repoRoot, ".cursor/skills"));
    expect(skillMd.length).toBe(14);
    expect(skillMd).toContain(".cursor/skills/core/hitl-gates/SKILL.md");
    expect(skillMd).toContain(".cursor/skills/core/qa/SKILL.md");
    expect(skillMd).toContain(".cursor/skills/core/dashboard-broadcast/SKILL.md");
    expect(skillMd).toContain(".cursor/skills/domain/llm-security-ops/SKILL.md");

    const inventory = readFileSync(join(repoRoot, "docs/capability-inventory.md"), "utf8");
    expect(inventory).toContain(`## Skills (.cursor/skills/ - ${skillMd.length} SKILL.md)`);
    expect(inventory).toMatch(/### Core skills with SKILL\.md \(5\)/);
    expect(inventory).toContain("`hitl-gates`");
    expect(inventory).toContain("`dashboard-broadcast`");
    expect(inventory).toContain("`llm-security-ops`");
    expect(inventory).not.toMatch(/## Skills \(\.cursor\/skills\/ - 11\)/);
    expect(inventory).not.toMatch(/### Core skills \(3\)/);
  });

  it("pins layers-spec L0 skills table to l0.ts skill targets", () => {
    const layers = readFileSync(join(repoRoot, "docs/layers-spec.md"), "utf8");
    const l0SkillTargets = L0_ARTIFACTS.filter((a) => a.target.startsWith(".cursor/skills/")).map(
      (a) => a.target,
    );

    expect(l0SkillTargets).toContain(".cursor/skills/core/hitl-gates/SKILL.md");
    expect(l0SkillTargets).toContain(".cursor/skills/core/qa/SKILL.md");
    expect(l0SkillTargets).toContain(".cursor/skills/core/dashboard-broadcast/SKILL.md");
    expect(l0SkillTargets).toContain(".cursor/skills/core/backlog-add/procedure.md");

    for (const target of l0SkillTargets) {
      // Hitl-gates dir is listed as a folder row; individual pages still appear in prose/table.
      if (target.startsWith(".cursor/skills/core/hitl-gates/")) {
        expect(layers).toContain(".cursor/skills/core/hitl-gates/");
        continue;
      }
      expect(layers).toContain(target);
    }
  });
});
