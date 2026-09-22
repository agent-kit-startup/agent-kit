import { describe, expect, it } from "vitest";
import {
  HANDOFF_EXCERPT_MAX_BYTES,
  HANDOFF_EXCERPT_MAX_LINES,
  HANDOFF_PROSE_LINE_MIN_BYTES,
  capHandoffExcerpt,
} from "./handoff-excerpt.js";

const B = (s: string) => Buffer.byteLength(s, "utf8");

function bigHandoff(proseLines = 40, proseChars = 3000): string {
  const prose = Array.from(
    { length: proseLines },
    (_, i) => `- **Tick ${i} (phase${i}, completed):** ${"lorem ipsum — ".repeat(proseChars / 14)}`,
  );
  return [
    "# Handoff - sample",
    "",
    "- **Plan:** `sample.plan.md`",
    "- **Last updated:** 2026-09-20 11:00",
    "- **Mode:** run-plan (orchestrated)",
    ...prose,
    "- **Instruction for the next agent:** Resume Phase 1.",
    "",
    "## Work Status",
    "",
    "- **In progress:** phase4-inference-efficiency",
    "- **Backlog plans:** (history: moved to the Run queue)",
    "  - `cartesi.plan.md` (returned to Backlog 2026-09-19)",
    "  - `contract-read-budget.plan.md` (enqueued 2026-09-19)",
    "- **Parked plans:** none",
    "- **Run queue:** `a.plan.md`, `b.plan.md`",
    "- **Queue cursor:** 1/2",
    "- **Queue status:** running",
    "",
  ].join("\n");
}

describe("capHandoffExcerpt", () => {
  it("defaults: 60 lines and 12 KiB", () => {
    expect(HANDOFF_EXCERPT_MAX_LINES).toBe(60);
    expect(HANDOFF_EXCERPT_MAX_BYTES).toBe(12_288);
    expect(HANDOFF_PROSE_LINE_MIN_BYTES).toBe(160);
  });

  it("returns a small HANDOFF byte-identical (no marker, no drop)", () => {
    const text = "# Handoff\n\n- **Plan:** `x.plan.md`\n- **Gaps:** none\n";
    const r = capHandoffExcerpt(text);
    expect(r.text).toBe(text.trim());
    expect(r.truncatedLines).toBe(0);
    expect(r.droppedLines).toBe(0);
    expect(r.text).not.toContain("truncated");
  });

  it("keeps the 60-line outer bound", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `- line ${i}`);
    const r = capHandoffExcerpt(lines.join("\n"));
    expect(r.lines).toBe(60);
    expect(r.text.split("\n")).toHaveLength(60);
    expect(r.text).toContain("- line 59");
    expect(r.text).not.toContain("- line 60");
  });

  it("respects the byte budget and keeps machine fields whole", () => {
    const source = bigHandoff();
    expect(B(source)).toBeGreaterThan(HANDOFF_EXCERPT_MAX_BYTES);
    const r = capHandoffExcerpt(source);
    expect(r.bytes).toBeLessThanOrEqual(HANDOFF_EXCERPT_MAX_BYTES);
    expect(B(r.text)).toBe(r.bytes);
    for (const machine of [
      "- **Plan:** `sample.plan.md`",
      "- **Last updated:** 2026-09-20 11:00",
      "- **Mode:** run-plan (orchestrated)",
      "- **In progress:** phase4-inference-efficiency",
      "- **Backlog plans:** (history: moved to the Run queue)",
      "  - `cartesi.plan.md` (returned to Backlog 2026-09-19)",
      "  - `contract-read-budget.plan.md` (enqueued 2026-09-19)",
      "- **Parked plans:** none",
      "- **Run queue:** `a.plan.md`, `b.plan.md`",
      "- **Queue cursor:** 1/2",
      "- **Queue status:** running",
    ]) {
      expect(r.text.split("\n")).toContain(machine);
    }
    expect(r.text).toContain("# Handoff - sample");
    expect(r.text).toContain("## Work Status");
  });

  it("truncates prose per line with a visible marker and no drops when the floor fits", () => {
    const r = capHandoffExcerpt(bigHandoff());
    expect(r.droppedLines).toBe(0);
    expect(r.truncatedLines).toBe(40);
    const marked = r.text.split("\n").filter((l) => / …\[truncated \d+ chars\]$/.test(l));
    expect(marked).toHaveLength(40);
    for (const line of marked) {
      expect(line.startsWith("- **Tick ")).toBe(true);
      expect(B(line)).toBeGreaterThanOrEqual(HANDOFF_PROSE_LINE_MIN_BYTES - 32);
    }
    // Short prose survives untouched.
    expect(r.text).toContain("- **Instruction for the next agent:** Resume Phase 1.");
  });

  it("drops prose lines last-first only when the floor does not fit, with a note", () => {
    const r = capHandoffExcerpt(bigHandoff(), { maxBytes: 4_096 });
    expect(r.bytes).toBeLessThanOrEqual(4_096);
    expect(r.droppedLines).toBeGreaterThan(0);
    expect(r.text).toMatch(
      /…\[\d+ prose lines omitted by the excerpt byte cap; read \.cursor\/HANDOFF\.md\]$/,
    );
    // Earliest prose lines survive, the last ones go first.
    expect(r.text).toContain("- **Tick 0 (phase0, completed):**");
    expect(r.text).not.toContain("- **Instruction for the next agent:**");
    // Machine fields after the dropped prose are still whole.
    expect(r.text).toContain("- **Queue status:** running");
    expect(r.text).toContain("  - `contract-read-budget.plan.md` (enqueued 2026-09-19)");
  });

  it("cuts multibyte prose at a code-point boundary", () => {
    const line = `- **Note:** ${"—…é".repeat(2_000)}`;
    const r = capHandoffExcerpt(`- **Plan:** \`x.plan.md\`\n${line}\n`, { maxBytes: 600 });
    expect(r.bytes).toBeLessThanOrEqual(600);
    const truncated = r.text.split("\n")[1] ?? "";
    expect(truncated).toMatch(/^- \*\*Note:\*\* (—…é)+—?…? …\[truncated \d+ chars\]$/);
    expect(truncated).not.toContain("�");
  });

  it("does not treat look-alike labels as machine fields", () => {
    const stale = `- **Mode (prior, stale):** ${"x".repeat(3_000)}`;
    const r = capHandoffExcerpt(`- **Mode:** run-plan\n${stale}\n`, { maxBytes: 400 });
    expect(r.text).toContain("- **Mode:** run-plan");
    expect(r.text).toMatch(/- \*\*Mode \(prior, stale\):\*\* x+ …\[truncated \d+ chars\]/);
  });
});
