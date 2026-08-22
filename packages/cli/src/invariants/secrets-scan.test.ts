import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECRET_PATTERNS, scanTextForSecrets } from "./secrets-scan.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

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

  it("detects hyphenated vendor sk- keys that openai-sk cannot cross", () => {
    // Split so no contiguous key literal exists in the repo (public-sync content guard).
    const anthropic = `paste ${"sk"}-${"ant"}-api03-${"A1b2C3d4E5f6G7h8J9k0L1m2"}`;
    const hits = scanTextForSecrets(anthropic);
    expect(hits.some((h) => h.patternId === "sk-hyphenated-vendor")).toBe(true);
    // The OpenAI-shaped pattern must not claim this shape: its body class excludes `-`.
    expect(hits.some((h) => h.patternId === "openai-sk")).toBe(false);

    const project = `paste ${"sk"}-${"proj"}-${"A1b2C3d4E5f6G7h8J9k0L1m2"}`;
    expect(scanTextForSecrets(project).some((h) => h.patternId === "sk-hyphenated-vendor")).toBe(
      true,
    );
  });

  it("still detects single-segment sk- keys under openai-sk", () => {
    const sample = `paste ${"sk"}-${"A1b2C3d4E5f6G7h8J9k0L1m2"}`;
    const hits = scanTextForSecrets(sample);
    expect(hits.some((h) => h.patternId === "openai-sk")).toBe(true);
    expect(hits.some((h) => h.patternId === "sk-hyphenated-vendor")).toBe(false);
  });

  it("masks hyphenated vendor key bodies in excerpts", () => {
    const body = "A1b2C3d4E5f6G7h8J9k0L1m2";
    const sample = `paste ${"sk"}-${"ant"}-api03-${body}`;
    const hit = scanTextForSecrets(sample).find((h) => h.patternId === "sk-hyphenated-vendor");
    expect(hit).toBeTruthy();
    expect(hit?.excerpt).not.toMatch(new RegExp(body));
    expect(hit?.excerpt).not.toMatch(/api03/);
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

describe("pre-commit check-secrets parity is one-way", () => {
  const hook = readFileSync(resolve(repoRoot, ".cursor/hooks/pre-commit/check-secrets.sh"), "utf8");

  it("pins the hook to the single json-secret-kv expression", () => {
    // The comment above SECRET_PATTERNS states the hook greps exactly one expression.
    const greps = hook.split("\n").filter((line) => /^\s*if grep -E /.test(line));
    expect(greps).toHaveLength(1);
    expect(greps[0]).toContain('"(password|apiKey|api_key|secret|token|auth)"');
  });

  it("pins the hook to its extension allowlist", () => {
    expect(hook).toContain("*.json|*.js|*.ts|*.env)");
    // No second `case` arm: .md / .yaml / .sh / dotfiles are not scanned.
    expect(hook.match(/^\s*\*[^)]*\)\s*$/gm) ?? []).toHaveLength(1);
  });

  it("keeps the superset direction true: only json-secret-kv has a hook counterpart", () => {
    const withCounterpart = SECRET_PATTERNS.filter(({ id }) => id === "json-secret-kv");
    const withoutCounterpart = SECRET_PATTERNS.filter(({ id }) => id !== "json-secret-kv");
    expect(withCounterpart).toHaveLength(1);
    // Named in the comment; if this list changes the comment must change with it.
    expect(withoutCounterpart.map((p) => p.id)).toEqual([
      "env-assignment",
      "aws-access-key",
      "github-pat",
      "sk-hyphenated-vendor",
      "openai-sk",
    ]);
  });
});
