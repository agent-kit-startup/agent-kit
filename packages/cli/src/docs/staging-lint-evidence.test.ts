import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

/**
 * Mechanical pin: staging-ready lint-evidence clause must remain in the three
 * staging / run-plan surfaces. Removing the clause fails this test (close-audit B).
 * ADR pin below is private-factory only (public-sync excludes `.cursor/memory/**`);
 * skip when the file is absent so public mirror CI does not ENOENT.
 */
describe("docs-contract: staging lint-evidence clause", () => {
  const surfaces = [
    ".cursor/commands/git-staging.md",
    ".cursor/commands/run-plan.md",
    "autogit/gitupdate.md",
  ] as const;

  for (const rel of surfaces) {
    it(`keeps lint-evidence / Staging ready gate prose in ${rel}`, () => {
      const body = readFileSync(resolve(repoRoot, rel), "utf8");
      // Contract string alone is not evidence (must be stated).
      expect(body).toMatch(/Staging ready:\s*yes|Staging-ready lint|lint evidence/i);
      expect(body).toMatch(
        /not\s+(?:evidence|the contract)|contract (?:string|phrase) alone|without that (?:evidence|recorded run) is invalid/i,
      );
      expect(body).toMatch(/none applicable|no applicable/i);
    });
  }

  it("documents dashboard-CSS none-applicable / plugin-ux-validation coverage convention", () => {
    // Private-factory ADR; public mirror never receives `.cursor/memory/**`.
    const adrPath = resolve(
      repoRoot,
      ".cursor/memory/decisions/2026-07-29_dashboard-css-lint-evidence-convention.md",
    );
    if (!existsSync(adrPath)) {
      return;
    }

    const adr = readFileSync(adrPath, "utf8");
    expect(adr).toMatch(/plugin-ux-validation/i);
    expect(adr).toMatch(/none applicable/i);
    expect(adr).toMatch(/dashboard\.html|dashboard-CSS/i);
  });

  it("pins dashboard-CSS lint clause on run-plan Staging-ready gate", () => {
    const body = readFileSync(resolve(repoRoot, ".cursor/commands/run-plan.md"), "utf8");
    expect(body).toMatch(/dashboard-CSS/i);
    expect(body).toMatch(/plugin-ux-validation/i);
    expect(body).toMatch(/none applicable \(dashboard-CSS\)/i);
  });

  it("pins dashboard-CSS lint clause on git-staging", () => {
    const body = readFileSync(resolve(repoRoot, ".cursor/commands/git-staging.md"), "utf8");
    expect(body).toMatch(/dashboard-CSS/i);
    expect(body).toMatch(/plugin-ux-validation/i);
  });

  it("keeps gitupdate out of claiming Biome on dashboard.html", () => {
    const body = readFileSync(resolve(repoRoot, "autogit/gitupdate.md"), "utf8");
    expect(body).toMatch(/dashboard\/dashboard\.html`? is outside Biome/i);
    expect(body).toMatch(/dashboard-CSS/i);
    // Old incorrect scope listed dashboard/ alongside packages/ as Biome/ESLint.
    expect(body).not.toMatch(/under `packages\/`, `dashboard\//);
  });
});

/**
 * Mechanical pin: audit PTY honesty clauses must stay in L0 commands and the
 * external-plan-review docs. Removing or weakening the exit-3, progress-gate,
 * or session-cap/warn clauses fails this test.
 */
describe("docs-contract: audit PTY honesty clauses", () => {
  it("pins exit 3 = timeout-only across L0 audit commands", () => {
    for (const rel of [
      ".cursor/commands/run-plan.md",
      ".cursor/commands/run-plan-all.md",
      ".cursor/commands/plan-external-review.md",
    ]) {
      const body = readFileSync(resolve(repoRoot, rel), "utf8");
      expect(body).toMatch(/exit[\s`]+3/i);
      expect(body).toMatch(/timeout[\s-]*only/i);
      expect(body).toMatch(
        /(?:do|does)(?:\*\*)?[\s*]+not(?:\*\*)?[\s*]+(?:retroactively\s+)?(?:convert|upgrade|rewrite)/i,
      );
    }
  });

  it("pins exit 3 = timeout-only in external-plan-review docs", () => {
    const body = readFileSync(resolve(repoRoot, "docs/external-plan-review.md"), "utf8");
    expect(body).toMatch(/exit[\s`]+3/i);
    expect(body).toMatch(/timeout[\s-]*only/i);
    expect(body).toMatch(
      /never[\s]+review[\s]+done|(?:do|does)(?:\*\*)?[\s*]+not(?:\*\*)?[\s*]+(?:retroactively\s+)?(?:convert|upgrade|rewrite)/i,
    );
  });

  it("pins post-spawn progress gate banner-baseline behavior in docs", () => {
    const body = readFileSync(resolve(repoRoot, "docs/external-plan-review.md"), "utf8");
    expect(body).toMatch(/progress gate/i);
    expect(body).toMatch(/banner|pre-exec|growth beyond/i);
    expect(body).toMatch(/scrollback/i);
  });

  it("pins session cap/warn concurrency note in docs", () => {
    const body = readFileSync(resolve(repoRoot, "docs/external-plan-review.md"), "utf8");
    expect(body).toMatch(/AGENT_KIT_AUDIT_SESSION_CAP/i);
    expect(body).toMatch(/AGENT_KIT_AUDIT_SESSION_WARN/i);
    expect(body).toMatch(/detached/i);
    expect(body).toMatch(/concurrency|healthy autonomous/i);
  });
});
