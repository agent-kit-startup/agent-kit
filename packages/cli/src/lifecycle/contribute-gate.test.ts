import { describe, expect, it } from "vitest";
import { gateContributeContent, gateContributePath } from "./contribute-gate.js";

describe("contribute gate", () => {
  it("blocks session paths", () => {
    const issues = gateContributePath(".cursor/HANDOFF.md");
    expect(issues.some((i) => i.code === "path-blocked")).toBe(true);
  });

  it("rejects secrets and metalinguage", () => {
    // Fake token assembled at runtime so the literal never sits in the repo
    // (the public-sync content guard scans source files for secret shapes).
    const fakePat = `ghp_${"a".repeat(36)}`;
    const bad = gateContributeContent(
      `token: '${fakePat}'\ncomo IA eu acho\n`,
      ".cursor/rules/ux-tone.mdc",
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["secret-github-pat", "meta-agent"]),
    );
  });

  it("accepts clean L0-like content", () => {
    const ok = gateContributeContent(
      "# UX tone\n\nKeep chat short. Prefer clear next steps.\n",
      ".cursor/rules/ux-tone.mdc",
    );
    expect(ok.ok).toBe(true);
  });
});
