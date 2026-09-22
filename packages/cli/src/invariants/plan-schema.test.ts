import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validatePlanFrontmatterText } from "./plan-schema.js";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TEMPLATE_PATH = path.join(kitRoot, ".cursor", "context", "templates", "plan.md");

describe("validatePlanFrontmatterText", () => {
  it("accepts the canonical template's two-space-indented todo items", async () => {
    // .cursor/context/templates/plan.md indents `- id:` by two spaces under
    // `todos:`; a plan authored exactly by that template must not be flagged
    // empty-todos (dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md, defect 7).
    const template = await readFile(TEMPLATE_PATH, "utf8");
    const warnings = validatePlanFrontmatterText(template);
    expect(warnings.map((w) => w.code)).not.toContain("empty-todos");
  });

  it("accepts column-0 todo items (unchanged behavior)", () => {
    const text = ["---", "name: x", "todos:", "- id: phase0", "  status: pending", "---"].join(
      "\n",
    );
    const warnings = validatePlanFrontmatterText(text);
    expect(warnings.map((w) => w.code)).not.toContain("empty-todos");
  });

  it("accepts arbitrarily indented todo items", () => {
    const text = [
      "---",
      "name: x",
      "todos:",
      "    - id: phase0",
      "      status: pending",
      "---",
    ].join("\n");
    const warnings = validatePlanFrontmatterText(text);
    expect(warnings.map((w) => w.code)).not.toContain("empty-todos");
  });

  it("still flags a genuinely empty todos list", () => {
    const text = ["---", "name: x", "todos:", "---"].join("\n");
    const warnings = validatePlanFrontmatterText(text);
    expect(warnings.map((w) => w.code)).toContain("empty-todos");
  });

  it("still flags missing frontmatter, name, and todos key", () => {
    expect(validatePlanFrontmatterText("no frontmatter here").map((w) => w.code)).toEqual([
      "missing-frontmatter",
    ]);
    const noName = ["---", "todos:", "- id: phase0", "---"].join("\n");
    expect(validatePlanFrontmatterText(noName).map((w) => w.code)).toContain("missing-name");
    const noTodos = ["---", "name: x", "---"].join("\n");
    expect(validatePlanFrontmatterText(noTodos).map((w) => w.code)).toContain("missing-todos");
  });
});
