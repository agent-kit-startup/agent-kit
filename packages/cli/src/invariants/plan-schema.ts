/** Lightweight plan frontmatter checks (advisory). */

export interface PlanWarning {
  code: string;
  message: string;
  cite: string;
}

const CITE = "agent-kit validate plan (.cursor/context/templates/plan.md)";

export function validatePlanFrontmatterText(text: string): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) {
    warnings.push({
      code: "missing-frontmatter",
      message: "Plan file has no YAML frontmatter block.",
      cite: CITE,
    });
    return warnings;
  }
  const block = match[1];
  if (!/^todos:\s*$/m.test(block) && !/^todos:\s*\[/m.test(block)) {
    // Allow todos: with list items under it
    if (!/^todos:/m.test(block)) {
      warnings.push({
        code: "missing-todos",
        message: "Plan frontmatter has no `todos:` key.",
        cite: CITE,
      });
    }
  }
  if (!/^name:\s*\S+/m.test(block)) {
    warnings.push({
      code: "missing-name",
      message: "Plan frontmatter has no `name:` key.",
      cite: CITE,
    });
  }
  const hasTodoItem = /^- id:\s*\S+/m.test(block);
  if (/^todos:/m.test(block) && !hasTodoItem && !/^todos:\s*\[\s*\]/m.test(block)) {
    warnings.push({
      code: "empty-todos",
      message: "Plan frontmatter `todos:` has no `- id:` items.",
      cite: CITE,
    });
  }
  return warnings;
}
