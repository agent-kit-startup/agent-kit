/** HANDOFF machine-field schema checks (advisory annotate; do not block sessions). */

export interface HandoffWarning {
  code: string;
  message: string;
  /** Canonical prose/CLI pointer for denial or annotate messages. */
  cite: string;
}

const MACHINE_LIST_CHECKS: Array<{
  heading: string;
  fieldLabels: string[];
  code: string;
}> = [
  {
    heading: "Backlog plans",
    fieldLabels: ["Backlog plans", "Backlog"],
    code: "heading-without-field-backlog",
  },
  {
    heading: "Parked plans",
    fieldLabels: ["Parked plans"],
    code: "heading-without-field-parked",
  },
  {
    heading: "Run queue",
    fieldLabels: ["Run queue"],
    code: "heading-without-field-run-queue",
  },
];

const CITE = "agent-kit validate handoff (see .cursor/context/templates/handoff.md)";

/**
 * Heuristic: `## Backlog plans` (etc.) without `- **Field:**` breaks Mission Control parsers.
 */
export function validateHandoffText(text: string): HandoffWarning[] {
  if (!text.trim()) return [];
  const warnings: HandoffWarning[] = [];
  for (const check of MACHINE_LIST_CHECKS) {
    const headingRe = new RegExp(`^##\\s+${check.heading}\\s*$`, "m");
    if (!headingRe.test(text)) continue;
    const hasField = check.fieldLabels.some((label) =>
      new RegExp(`^- \\*\\*${label}:\\*\\*`, "m").test(text),
    );
    if (!hasField) {
      warnings.push({
        code: check.code,
        message: `\`## ${check.heading}\` found without \`- **${check.fieldLabels[0]}:**\` (Mission Control will miss this list; rewrite as a field bullet).`,
        cite: CITE,
      });
    }
  }
  return warnings;
}
