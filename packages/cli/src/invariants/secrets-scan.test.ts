import { describe, expect, it } from "vitest";
import { scanTextForSecrets } from "./secrets-scan.js";

describe("scanTextForSecrets", () => {
  it("returns empty for clean prompt", () => {
    expect(scanTextForSecrets("fix the handoff template")).toEqual([]);
  });

  it("detects env-style secrets", () => {
    // Split Stripe live-key sample so GitHub push protection does not block public sync.
    const sample = `export API_KEY=${"sk"}_${"live"}_abcdefghijklmnopqrstuvwxyz`;
    const hits = scanTextForSecrets(sample);
    expect(hits.some((h) => h.patternId === "env-assignment")).toBe(true);
  });

  it("detects github pats", () => {
    // Build sample without a contiguous ghp_… literal (public-sync content guard).
    const sample = `token ${"ghp"}_${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    const hits = scanTextForSecrets(sample);
    expect(hits.some((h) => h.patternId === "github-pat")).toBe(true);
  });
});
