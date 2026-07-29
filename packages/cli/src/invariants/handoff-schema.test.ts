import { describe, expect, it } from "vitest";
import { validateHandoffText } from "./handoff-schema.js";

describe("validateHandoffText", () => {
  it("passes bullet machine fields", () => {
    const text = `- **Plan:** \`x.plan.md\`
- **Backlog plans:**
  - \`other.plan.md\`
- **Parked plans:** none
`;
    expect(validateHandoffText(text)).toEqual([]);
  });

  it("flags ## Backlog plans without field bullet", () => {
    const text = "## Backlog plans\n\n- `other.plan.md`\n";
    const w = validateHandoffText(text);
    expect(w).toHaveLength(1);
    expect(w[0]?.code).toBe("heading-without-field-backlog");
  });
});
