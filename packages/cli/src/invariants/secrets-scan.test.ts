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

  it("masks secret material in excerpts", () => {
    const sample = `deploy with API_KEY=${"sk"}_${"live"}_abcdefghijklmnop`;
    const hits = scanTextForSecrets(sample);
    const hit = hits.find((h) => h.patternId === "env-assignment");
    expect(hit).toBeTruthy();
    expect(hit?.excerpt).not.toMatch(/abcdefghijklmnop/);
    expect(hit?.excerpt).toContain("*");
  });

  it("masks json-secret-kv values in excerpts", () => {
    const sample = 'config: {"apiKey": "A1b2C3d4E5f6G7h8J9k0"} end';
    const hits = scanTextForSecrets(sample);
    const hit = hits.find((h) => h.patternId === "json-secret-kv");
    expect(hit).toBeTruthy();
    expect(hit?.excerpt).not.toMatch(/A1b2C3d4E5f6G7h8J9k0/);
    expect(hit?.excerpt).toContain("*");
    expect(hit?.excerpt).toMatch(/apiKey"\s*:\s*"\*+/);
  });
});
