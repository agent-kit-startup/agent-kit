import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { L0_ARTIFACTS } from "../lifecycle/l0.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

/**
 * Phase 2 size pins (`contract-read-budget-lazy-layers-2026-09-19` plan,
 * ADR `decisions/2026-09-20_contract-read-budget-and-laziness.md` + its
 * Phase 1 / Phase 2 amendments). Every budget below traces to that ADR;
 * read it before changing a number here.
 *
 * Units are bytes, lines, and longest line only -- never tokens (ADR
 * `2026-08-14`). Two shapes of ceiling:
 *   - "target" ceilings are the ADR's real per-class budget: every member
 *     must already comply, and the ceiling is the budget itself (tight).
 *   - "current-state" ceilings apply only to the two classes the ADR
 *     explicitly scoped out of this phase (`alwaysApply` rules -> Phase 3;
 *     templates -> advisory/soft target, never gated tight). These pin at
 *     today's measured size plus headroom so a further silent regrowth
 *     (the #901 failure mode) still fails CI, without inventing a shrink
 *     this phase did not do.
 */

interface Measured {
  bytes: number;
  lines: number;
  longestLine: number;
}

function measureText(text: string): Measured {
  const bytes = Buffer.byteLength(text, "utf8");
  const lines = text.split("\n");
  let longestLine = 0;
  for (const line of lines) {
    if (line.length > longestLine) longestLine = line.length;
  }
  return { bytes, lines: lines.length, longestLine };
}

function measureFile(relPath: string): Measured {
  return measureText(readFileSync(resolve(repoRoot, relPath), "utf8"));
}

function isAlwaysApply(relPath: string): boolean {
  const text = readFileSync(resolve(repoRoot, relPath), "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return false;
  return /alwaysApply:\s*true/.test(match[1] ?? "");
}

describe("size-budgets: measureText proves the checker (deliberate over-budget fixture)", () => {
  it("flags a line-count violation", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    expect(measureText(text).lines).toBe(10);
    expect(measureText(text).lines).toBeGreaterThan(5); // would fail a max-5-lines budget
  });

  it("flags a byte violation independent of line count", () => {
    const text = "x".repeat(9000); // one line, no newlines
    const m = measureText(text);
    expect(m.lines).toBe(1);
    expect(m.bytes).toBeGreaterThan(8192); // would fail an 8 KiB budget despite 1 line
  });

  it("flags a longest-line violation that a line-count budget alone would miss", () => {
    const text = `short\n${"y".repeat(1200)}\nshort`;
    const m = measureText(text);
    expect(m.lines).toBe(3); // well under any reasonable line cap
    expect(m.longestLine).toBeGreaterThan(700); // still fails the longest-line budget
  });

  it("measures multi-byte utf8 content in bytes, not code points", () => {
    // "é" is 1 UTF-16 code unit / JS string char but 2 UTF-8 bytes.
    const text = "é".repeat(100);
    const m = measureText(text);
    expect(m.longestLine).toBe(100);
    expect(m.bytes).toBe(200);
  });
});

describe("size-budgets: consumer-L0 commands (target ceiling: 150 lines / 8192 B / 700 chars)", () => {
  const MAX_LINES = 150;
  const MAX_BYTES = 8192;
  const MAX_LONGEST_LINE = 700;

  const commandTargets = L0_ARTIFACTS.map((a) => a.target).filter((t) =>
    t.startsWith(".cursor/commands/"),
  );

  it("has the expected non-empty membership (derived from L0_ARTIFACTS, not hardcoded)", () => {
    expect(commandTargets.length).toBeGreaterThan(15);
    expect(commandTargets).toContain(".cursor/commands/run-plan.md");
    expect(commandTargets).toContain(".cursor/commands/plan-review-triage.md");
  });

  for (const target of commandTargets) {
    it(`${target} stays within budget`, () => {
      const m = measureFile(target);
      expect(m.lines, `${target} lines`).toBeLessThanOrEqual(MAX_LINES);
      expect(m.bytes, `${target} bytes`).toBeLessThanOrEqual(MAX_BYTES);
      expect(m.longestLine, `${target} longest line`).toBeLessThanOrEqual(MAX_LONGEST_LINE);
    });
  }
});

const claudeAdapterDir = resolve(repoRoot, ".claude/commands");
/** Factory dogfood adapters are private-only; public-sync does not allowlist them. */
const factoryClaudeAdaptersPresent = existsSync(claudeAdapterDir);

describe.skipIf(!factoryClaudeAdaptersPresent)(
  "size-budgets: .claude/commands/*.md adapters (target ceiling: 25 lines / 2048 B / 500 chars)",
  () => {
    const MAX_LINES = 25;
    const MAX_BYTES = 2048;
    const MAX_LONGEST_LINE = 500;

    const adapterFiles = readdirSync(claudeAdapterDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => `.claude/commands/${f}`);

    it("has the expected non-empty membership", () => {
      expect(adapterFiles.length).toBeGreaterThan(15);
    });

    for (const target of adapterFiles) {
      it(`${target} stays within budget`, () => {
        const m = measureFile(target);
        expect(m.lines, `${target} lines`).toBeLessThanOrEqual(MAX_LINES);
        expect(m.bytes, `${target} bytes`).toBeLessThanOrEqual(MAX_BYTES);
        expect(m.longestLine, `${target} longest line`).toBeLessThanOrEqual(MAX_LONGEST_LINE);
      });
    }
  },
);

describe("size-budgets: SKILL.md (target ceiling: 200 lines / 14336 B / 700 chars)", () => {
  const MAX_LINES = 200;
  const MAX_BYTES = 14336;
  const MAX_LONGEST_LINE = 700;

  const skillMdTargets = L0_ARTIFACTS.map((a) => a.target).filter(
    (t) => t.startsWith(".cursor/skills/") && t.endsWith("/SKILL.md"),
  );

  it("has the expected non-empty membership", () => {
    expect(skillMdTargets).toContain(".cursor/skills/core/hitl-gates/SKILL.md");
    expect(skillMdTargets).toContain(".cursor/skills/core/qa/SKILL.md");
  });

  for (const target of skillMdTargets) {
    it(`${target} stays within budget`, () => {
      const m = measureFile(target);
      expect(m.lines, `${target} lines`).toBeLessThanOrEqual(MAX_LINES);
      expect(m.bytes, `${target} bytes`).toBeLessThanOrEqual(MAX_BYTES);
      expect(m.longestLine, `${target} longest line`).toBeLessThanOrEqual(MAX_LONGEST_LINE);
    });
  }
});

describe("size-budgets: per-command procedure page (target ceiling: 250 lines / 10240 B / 700 chars)", () => {
  const MAX_LINES = 250;
  const MAX_BYTES = 10240;
  const MAX_LONGEST_LINE = 700;

  // Large procedure pages are a distinct, wider class (below); the
  // procedures.md redirect stub is neither (10 lines, kept for stale
  // consumer overlays, not itself a procedure).
  const LARGE_PAGE_MEMBERS = new Set([
    ".cursor/skills/core/hitl-gates/run-plan-tick-contract.md",
    ".cursor/skills/core/hitl-gates/run-plan-all-queue.md",
    ".cursor/skills/core/hitl-gates/start-project-intake.md",
    ".cursor/skills/core/plan-review-triage/procedure.md",
  ]);
  const REDIRECT_STUBS = new Set([".cursor/skills/core/hitl-gates/procedures.md"]);

  const pageTargets = L0_ARTIFACTS.map((a) => a.target).filter(
    (t) =>
      t.startsWith(".cursor/skills/") &&
      !t.endsWith("/SKILL.md") &&
      !LARGE_PAGE_MEMBERS.has(t) &&
      !REDIRECT_STUBS.has(t),
  );

  it("has the expected non-empty membership", () => {
    expect(pageTargets).toContain(".cursor/skills/core/backlog-add/procedure.md");
    expect(pageTargets).toContain(".cursor/skills/core/field-report-resolve/procedure.md");
    expect(pageTargets).toContain(".cursor/skills/core/agent-kit-onboard/procedure.md");
    expect(pageTargets).toContain(".cursor/skills/core/plan-external-review/procedure.md");
  });

  for (const target of pageTargets) {
    it(`${target} stays within budget`, () => {
      const m = measureFile(target);
      expect(m.lines, `${target} lines`).toBeLessThanOrEqual(MAX_LINES);
      expect(m.bytes, `${target} bytes`).toBeLessThanOrEqual(MAX_BYTES);
      expect(m.longestLine, `${target} longest line`).toBeLessThanOrEqual(MAX_LONGEST_LINE);
    });
  }
});

describe("size-budgets: large procedure page (target ceiling: 400 lines / 49152 B; longest-line per Phase 2 amendment)", () => {
  const MAX_LINES = 400;
  const MAX_BYTES = 49152;
  // Two files are Phase 1's verbatim cut-and-paste from the original
  // `procedures.md` and were not re-wrapped (self-referential-edit risk;
  // see the ADR's Phase 2 amendment). Pinned at current longest line plus
  // headroom -- a recorded exception, not a silent gap. The other two meet
  // the unified 700-char page-scale ceiling.
  const LONGEST_LINE_OVERRIDE: Record<string, number> = {
    ".cursor/skills/core/hitl-gates/run-plan-tick-contract.md": 1800,
    ".cursor/skills/core/hitl-gates/run-plan-all-queue.md": 2700,
  };
  const DEFAULT_MAX_LONGEST_LINE = 700;

  const members = [
    ".cursor/skills/core/hitl-gates/run-plan-tick-contract.md",
    ".cursor/skills/core/hitl-gates/run-plan-all-queue.md",
    ".cursor/skills/core/hitl-gates/start-project-intake.md",
    ".cursor/skills/core/plan-review-triage/procedure.md",
  ];

  for (const target of members) {
    it(`${target} stays within budget`, () => {
      const m = measureFile(target);
      const maxLongestLine = LONGEST_LINE_OVERRIDE[target] ?? DEFAULT_MAX_LONGEST_LINE;
      expect(m.lines, `${target} lines`).toBeLessThanOrEqual(MAX_LINES);
      expect(m.bytes, `${target} bytes`).toBeLessThanOrEqual(MAX_BYTES);
      expect(m.longestLine, `${target} longest line`).toBeLessThanOrEqual(maxLongestLine);
    });
  }
});

describe("size-budgets: alwaysApply rule (current-state ceiling; Phase 0 target is 100 lines / 4096 B / 500 chars, owned by Phase 3)", () => {
  // Per-file ceiling: generous enough that every current rule passes, tight
  // enough to catch unbounded growth (matches the consumer-L0-command
  // budget as a convenient, already-justified round number).
  const MAX_LINES = 150;
  const MAX_BYTES = 8192;
  // Phase 3 folded cursor-plan-handoff.mdc and context-guardian.mdc's
  // HARD_RULES-duplicate paragraphs into short pointers, which also fixed
  // their longest-line overage (894 / 503 -> 472 / 460); every alwaysApply
  // rule now meets the real 500-char target.
  const MAX_LONGEST_LINE = 500;
  // Aggregate ceiling: current measured total (36,880 B, down from the
  // Phase 0 baseline 38,968 B after Phase 3's fold) plus headroom. This is
  // the check that actually matters -- the remaining shrink is still
  // Phase 3/future work, and any tick that silently regrows the total
  // (the #901 failure mode) fails here even if every file still passes its
  // own ceiling.
  const MAX_AGGREGATE_BYTES = 40000;

  const ruleFiles = L0_ARTIFACTS.map((a) => a.target).filter((t) => t.startsWith(".cursor/rules/"));
  const alwaysApplyFiles = ruleFiles.filter(isAlwaysApply);

  it("has the expected non-empty membership (frontmatter-derived, not a hardcoded list)", () => {
    expect(alwaysApplyFiles.length).toBe(10);
  });

  for (const target of alwaysApplyFiles) {
    it(`${target} stays within the current-state ceiling`, () => {
      const m = measureFile(target);
      expect(m.lines, `${target} lines`).toBeLessThanOrEqual(MAX_LINES);
      expect(m.bytes, `${target} bytes`).toBeLessThanOrEqual(MAX_BYTES);
      expect(m.longestLine, `${target} longest line`).toBeLessThanOrEqual(MAX_LONGEST_LINE);
    });
  }

  it("keeps the aggregate alwaysApply fixed-load under the current-state ceiling", () => {
    const total = alwaysApplyFiles.reduce((sum, t) => sum + measureFile(t).bytes, 0);
    expect(total).toBeLessThanOrEqual(MAX_AGGREGATE_BYTES);
  });
});

describe("size-budgets: template (current-state ceiling; Phase 0 target is 250 lines / 10240 B / 700 chars, advisory not gated)", () => {
  const MAX_LINES = 250;
  const MAX_BYTES = 12288; // above plan.md's measured 10,835 B; still a real ceiling
  const MAX_LONGEST_LINE = 700;
  const MAX_AGGREGATE_BYTES = 38000; // current measured total 33,783 B plus headroom

  const templateTargets = L0_ARTIFACTS.map((a) => a.target).filter((t) =>
    t.startsWith(".cursor/context/templates/"),
  );

  it("has the expected non-empty membership", () => {
    expect(templateTargets).toContain(".cursor/context/templates/plan.md");
  });

  for (const target of templateTargets) {
    it(`${target} stays within the current-state ceiling`, () => {
      const m = measureFile(target);
      expect(m.lines, `${target} lines`).toBeLessThanOrEqual(MAX_LINES);
      expect(m.bytes, `${target} bytes`).toBeLessThanOrEqual(MAX_BYTES);
      expect(m.longestLine, `${target} longest line`).toBeLessThanOrEqual(MAX_LONGEST_LINE);
    });
  }

  it("keeps the aggregate template bulk under the current-state ceiling", () => {
    const total = templateTargets.reduce((sum, t) => sum + measureFile(t).bytes, 0);
    expect(total).toBeLessThanOrEqual(MAX_AGGREGATE_BYTES);
  });
});
