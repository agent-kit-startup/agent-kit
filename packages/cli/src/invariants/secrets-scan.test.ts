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

  it("detects github_pat_, gho_, PEM private keys and slack tokens", () => {
    // Split so no contiguous token / key literal exists in the repo (public-sync content guard).
    const fineGrained = `${"github"}_${"pat"}_${"11ABCDEFG0123456789abcdefghijklmnop"}`;
    const oauth = `${"gho"}_${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
    const pem = `-----${"BEGIN"} RSA ${"PRIVATE"} KEY-----\nMIIEowIBAAKCAQEAabcdefgh\n-----END RSA PRIVATE KEY-----`;
    const slack = `${"xoxb"}-${"1234567890-abcdefghijkl"}`;
    const hits = scanTextForSecrets(`a ${fineGrained} b ${oauth} c\n${pem}\nd ${slack} e`);
    expect(hits).toHaveLength(4);
    expect(hits.map((h) => h.patternId).sort()).toEqual([
      "github-pat",
      "github-pat",
      "pem-private-key",
      "slack-token",
    ]);
    const joined = hits.map((h) => h.excerpt).join(" ");
    expect(joined).not.toMatch(/0123456789abcdef/);
    expect(joined).not.toMatch(/MIIEow/);
    expect(joined).not.toMatch(/1234567890/);
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

  it("pins the hook to the staged added-lines diff, with no extension allowlist", () => {
    // The comment above SECRET_PATTERNS states the hook scans the staged diff of every path.
    expect(hook).toContain(
      "git diff --cached --no-ext-diff --no-textconv --no-color -U0 --diff-filter=ACMR",
    );
    expect(hook).not.toMatch(/^\s*case /m);
  });

  it("pins the hook ERE to every credential pattern plus json-secret-kv", () => {
    for (const fragment of [
      '"(password|apiKey|api_key|secret|token|auth)"',
      "AKIA[0-9A-Z]{16}",
      "gh[pousr]_[A-Za-z0-9_]{36,}",
      "github_pat_[A-Za-z0-9_]{22,}",
      "-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----",
      "xox[abposr]-[A-Za-z0-9-]{10,}",
      "sk-[A-Za-z0-9]{2,12}-[A-Za-z0-9_-]{16,}",
      "sk-[A-Za-z0-9]{20,}",
    ]) {
      expect(hook).toContain(fragment);
    }
  });

  it("keeps the superset direction true: only env-assignment lacks a hook counterpart", () => {
    // Named in the comment; if this list changes the comment must change with it.
    expect(SECRET_PATTERNS.filter(({ id }) => id !== "env-assignment").map((p) => p.id)).toEqual([
      "json-secret-kv",
      "aws-access-key",
      "github-pat",
      "pem-private-key",
      "slack-token",
      "sk-hyphenated-vendor",
      "openai-sk",
    ]);
    expect(hook).not.toMatch(/API_KEY\|SECRET\|PASSWORD/);
  });
});
