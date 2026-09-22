import { describe, expect, it } from "vitest";
import {
  HANDOFF_MAX_LINES,
  HANDOFF_MAX_LINE_LENGTH,
  checkHandoffGrowth,
  pruneHandoffText,
} from "./handoff-prune.js";

function synthHandoff(narrativeCount: number): string {
  const narrative = Array.from(
    { length: narrativeCount },
    (_, i) =>
      `- **Tick ${narrativeCount - i} (phase-${narrativeCount - i}, completed):** narrative body for tick ${narrativeCount - i}, with some detail on this line.\n`,
  ).join("\n");
  return `# Handoff - synth

- **Plan:** \`synth.plan.md\`
- **Last updated:** 2026-09-20 12:00
- **Mode:** run-plan (orchestrated)

${narrative}
## Work Status

- **In progress:** none
- **Backlog plans:**
  - \`other.plan.md\`
- **Parked plans:** none

## Session Context

- **Branch:** staging

---

## Run queue (multi-plan only)

- **Mode:** run-plan-all
- **Run queue:** [plan-a.plan.md, plan-b.plan.md]
- **Queue cursor:** 0 (current: plan-a.plan.md)
- **Queue status:** running
`;
}

describe("pruneHandoffText", () => {
  it("keeps the N most recent narrative chunks, archives the rest in order, preserves machine fields and trailing sections byte-identical", () => {
    const text = synthHandoff(8);
    const result = pruneHandoffText(text, 3);
    expect(result.ok).toBe(true);
    expect(result.keptCount).toBe(3);
    expect(result.archived).toHaveLength(5);
    // Archived in original (newest-first) order: Tick 4 down to Tick 1... wait,
    // synthHandoff writes ticks descending (8..1), so the first 3 chunks kept
    // are Tick 8, 7, 6; archived are Tick 5..1 in that same top-to-bottom order.
    expect(result.archived?.[0]).toContain("Tick 5");
    expect(result.archived?.[4]).toContain("Tick 1");

    const kept = result.text ?? "";
    expect(kept).toContain("Tick 8");
    expect(kept).toContain("Tick 7");
    expect(kept).toContain("Tick 6");
    expect(kept).not.toContain("Tick 5");
    expect(kept).not.toContain("Tick 1");

    // Machine fields survive byte-identical, wherever they sit.
    expect(kept).toContain("- **Plan:** `synth.plan.md`");
    expect(kept).toContain("- **Last updated:** 2026-09-20 12:00");
    expect(kept).toContain("- **Mode:** run-plan (orchestrated)");

    // Fixed-section trailing region, including the Run queue block, is untouched.
    const originalTrailing = text.slice(text.indexOf("## Work Status"));
    const newTrailing = kept.slice(kept.indexOf("## Work Status"));
    expect(newTrailing).toBe(originalTrailing);
  });

  it("nested continuation lines under a machine field travel with it, not archived separately", () => {
    const text = synthHandoff(6);
    const result = pruneHandoffText(text, 2);
    expect(result.ok).toBe(true);
    const kept = result.text ?? "";
    // The Backlog plans field and its nested row live in the trailing
    // Work Status section here, but confirm the pattern generally: no
    // archived chunk contains a bare nested bullet without its parent.
    for (const chunk of result.archived ?? []) {
      expect(chunk.startsWith("  -")).toBe(false);
    }
  });

  it("is a no-op (no archive) when narrative chunk count is already at or under keep", () => {
    const text = synthHandoff(2);
    const result = pruneHandoffText(text, 5);
    expect(result.ok).toBe(true);
    expect(result.archived).toEqual([]);
    expect(result.text).toBe(text);
  });

  it("refuses on a file with no machine-field bullets", () => {
    const text =
      "# Handoff - synth\n\n- **Tick 1:** just narrative, no fields.\n\n## Work Status\n\nnothing\n";
    const result = pruneHandoffText(text, 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no machine-field/i);
  });

  it("refuses on a file with no recognized fixed-section heading", () => {
    const text =
      "# Handoff - synth\n\n- **Plan:** `x.plan.md`\n\n- **Tick 1:** narrative only, no fixed section below.\n";
    const result = pruneHandoffText(text, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fixed-section/i);
  });

  it("refuses on an empty file", () => {
    expect(pruneHandoffText("", 1).ok).toBe(false);
    expect(pruneHandoffText("   \n  ", 1).ok).toBe(false);
  });
});

describe("checkHandoffGrowth", () => {
  it("flags a file over the line-count limit", () => {
    const text = Array.from({ length: HANDOFF_MAX_LINES + 20 }, (_, i) => `line ${i}`).join("\n");
    const warnings = checkHandoffGrowth(text);
    expect(warnings.some((w) => w.code === "file-over-limit")).toBe(true);
  });

  it("flags the first line over the longest-line limit, with its line number", () => {
    const text = `short\nshort\n${"x".repeat(HANDOFF_MAX_LINE_LENGTH + 100)}\nshort`;
    const warnings = checkHandoffGrowth(text);
    const w = warnings.find((w) => w.code === "line-over-limit");
    expect(w).toBeDefined();
    expect(w?.message).toContain("line 3");
  });

  it("returns no warnings for a compliant file", () => {
    const text = "# Handoff - x\n\n- **Plan:** `x.plan.md`\n";
    expect(checkHandoffGrowth(text)).toEqual([]);
  });

  it("returns no warnings for an empty file", () => {
    expect(checkHandoffGrowth("")).toEqual([]);
  });
});
