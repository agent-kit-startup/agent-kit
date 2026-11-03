import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectDecisionIndex,
  collectRules,
  DECISION_INDEX_CAP,
  DOC_TAGS_MAX,
  DOC_TITLE_MAX,
  decisionStatus,
  parseDecisionFile,
  parseRuleFile,
} from "../../../../dashboard/lib/workspace-docs.mjs";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ak-workspace-docs-"));
}

describe("parseRuleFile", () => {
  it("reads description, alwaysApply and a comma globs list from .mdc frontmatter", () => {
    const r = parseRuleFile(
      "a.mdc",
      '---\ndescription: "Hygiene for output"\nalwaysApply: true\nglobs: src/**/*.ts, docs/**\n---\n# A\n',
    );
    expect(r).toEqual({
      id: "a",
      file: "a.mdc",
      path: ".cursor/rules/a.mdc",
      description: "Hygiene for output",
      alwaysApply: true,
      globs: ["src/**/*.ts", "docs/**"],
    });
  });

  it("reads flow and block glob lists", () => {
    expect(parseRuleFile("f.mdc", "---\nglobs: [\"a/**\", 'b/*.md']\n---\n").globs).toEqual([
      "a/**",
      "b/*.md",
    ]);
    expect(
      parseRuleFile("b.mdc", "---\nglobs:\n  - x/**\n  - y.md\nalwaysApply: false\n---\n"),
    ).toMatchObject({ globs: ["x/**", "y.md"], alwaysApply: false });
  });

  it("falls back to the first heading without frontmatter, and degrades on unreadable files", () => {
    expect(parseRuleFile("plain.md", "# Plain rule\n\nbody").description).toBe("Plain rule");
    expect(parseRuleFile("gone.mdc", null)).toMatchObject({
      id: "gone",
      description: "",
      alwaysApply: false,
      globs: [],
    });
  });
});

describe("collectRules", () => {
  it("lists .mdc and .md rules sorted by id with kitManaged from the given paths", () => {
    const root = scratch();
    const dir = join(root, ".cursor", "rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "zeta.mdc"), "---\ndescription: Z\n---\n");
    writeFileSync(join(dir, "alpha.md"), "# Alpha\n");
    writeFileSync(join(dir, "notes.txt"), "ignored");
    const rules = collectRules(root, { kitPaths: new Set([".cursor/rules/zeta.mdc"]) });
    expect(rules.map((r) => [r.id, r.kitManaged])).toEqual([
      ["alpha", false],
      ["zeta", true],
    ]);
    expect(typeof rules[0].modifiedAt).toBe("string");
  });

  it("returns [] when the folder is missing", () => {
    expect(collectRules(scratch())).toEqual([]);
  });
});

describe("decisionStatus", () => {
  it("maps the first word to the memory-loop vocabulary", () => {
    expect(decisionStatus("Accepted 2026-10-25 (operator)")).toBe("accepted");
    expect(decisionStatus("Proposed.")).toBe("proposed");
    expect(decisionStatus("Superseded by x.md")).toBe("superseded");
    expect(decisionStatus("**Deprecated**")).toBe("deprecated");
    expect(decisionStatus("Draft")).toBe("unknown");
    expect(decisionStatus("")).toBe("unknown");
  });
});

describe("parseDecisionFile", () => {
  it("reads title, date, Status, inline tags and amend dates", () => {
    const d = parseDecisionFile(
      "2026-10-24_rail.md",
      [
        "# Colony rail",
        "",
        "- **Date:** 2026-10-24",
        "- **Status:** Accepted 2026-10-25 (operator)",
        "- **Status:** Proposed (a later line is not the Status)",
        "",
        "## Amend (2026-10-28)",
        "## Amend 2026-10-26 (operator)",
        "- **Tags:** colony, `rail`, more-menu",
      ].join("\n"),
    );
    expect(d).toEqual({
      id: "2026-10-24_rail",
      path: ".cursor/memory/decisions/2026-10-24_rail.md",
      title: "Colony rail",
      date: "2026-10-24",
      status: "accepted",
      statusText: "Accepted 2026-10-25 (operator)",
      tags: ["colony", "rail", "more-menu"],
      amends: ["2026-10-26", "2026-10-28"],
    });
  });

  it("reads tags from a ## Tags block and caps titles and tag counts", () => {
    const many = Array.from({ length: DOC_TAGS_MAX + 5 }, (_, i) => `t${i}`).join(", ");
    const d = parseDecisionFile(
      "2026-01-01_x.md",
      `# ${"T".repeat(DOC_TITLE_MAX + 50)}\n\n- **Status:** Proposed\n\n## Tags\n\n${many}\n`,
    );
    expect(d.title.length).toBe(DOC_TITLE_MAX);
    expect(d.tags).toHaveLength(DOC_TAGS_MAX);
    expect(d.status).toBe("proposed");
  });

  it("falls back to the id and the date prefix when the file is unreadable", () => {
    expect(parseDecisionFile("2026-02-03_gone.md", null)).toMatchObject({
      title: "2026-02-03_gone",
      date: "2026-02-03",
      status: "unknown",
      tags: [],
    });
  });
});

describe("collectDecisionIndex", () => {
  it("lists records newest file first and skips _index.md", () => {
    const root = scratch();
    const dir = join(root, ".cursor", "memory", "decisions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "_index.md"), "# Decisions index\n");
    writeFileSync(join(dir, "2026-01-01_old.md"), "# Old\n- **Status:** Superseded by new\n");
    writeFileSync(join(dir, "2026-10-01_new.md"), "# New\n- **Status:** Accepted\n");
    const idx = collectDecisionIndex(root);
    expect(idx.map((d) => [d.id, d.status])).toEqual([
      ["2026-10-01_new", "accepted"],
      ["2026-01-01_old", "superseded"],
    ]);
  });

  it("caps the index", () => {
    const root = scratch();
    const dir = join(root, ".cursor", "memory", "decisions");
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < DECISION_INDEX_CAP + 3; i++) {
      writeFileSync(join(dir, `2026-01-01_d${String(i).padStart(4, "0")}.md`), "# D\n");
    }
    expect(collectDecisionIndex(root)).toHaveLength(DECISION_INDEX_CAP);
  });

  it("returns [] when the folder is missing", () => {
    expect(collectDecisionIndex(scratch())).toEqual([]);
  });
});
