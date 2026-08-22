/** Prompt / text secrets scan (fail-open at hook; loud via doctor). */

export interface SecretHit {
  patternId: string;
  excerpt: string;
}

const CITE = "agent-kit guard prompt (docs/cursor-native-audit.md)";

/**
 * Prompt-leak pattern set. Its relationship to pre-commit `check-secrets` is
 * **one-way**: this set is a strict superset of the hook, never a mirror of it.
 *
 * `.cursor/hooks/pre-commit/check-secrets.sh` greps exactly one expression — the
 * `json-secret-kv` equivalent — and only under `case "$f" in *.json|*.js|*.ts|*.env)`.
 * So `env-assignment`, `aws-access-key`, `github-pat`, `sk-hyphenated-vendor` and
 * `openai-sk` have **no** pre-commit counterpart, and a committed `.md` / `.yaml` /
 * `.sh` / dotfile is scanned by neither lane. A clean `guard prompt` result is not
 * evidence that a commit would be blocked downstream.
 *
 * `secrets-scan.test.ts` pins this sentence against the hook file: widening
 * `check-secrets.sh` must update the test and this comment in the same change.
 */
export const SECRET_PATTERNS: Array<{ id: string; re: RegExp }> = [
  {
    id: "json-secret-kv",
    re: /"(password|apiKey|api_key|secret|token|auth)"\s*:\s*"[^"]{12,}"/i,
  },
  {
    id: "env-assignment",
    re: /\b(?:API_KEY|SECRET|PASSWORD|TOKEN|ACCESS_KEY|PRIVATE_KEY)\s*=\s*['"]?[^\s'"]{12,}/i,
  },
  {
    id: "aws-access-key",
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "github-pat",
    re: /\bghp_[A-Za-z0-9_]{36,}\b/,
  },
  // Hyphenated vendor keys (`sk-ant-api03-…`, `sk-proj-…`) cannot be matched by
  // `openai-sk`: its body class excludes `-`, so it stops at the first separator.
  // Listed before `openai-sk`; the two cannot both hit the same span.
  {
    id: "sk-hyphenated-vendor",
    re: /\bsk-[A-Za-z0-9]{2,12}-[A-Za-z0-9_-]{16,}\b/,
  },
  {
    // Single-segment `sk-` bodies only (no `-` in the class) — see `sk-hyphenated-vendor`.
    id: "openai-sk",
    re: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
];

function maskSecretExcerpt(raw: string): string {
  return (
    raw
      // Body class keeps `-` so hyphenated vendor keys (`sk-ant-api03-…`) are masked too;
      // without it the mask needs 4+ non-hyphen chars after `sk-` and `ant` is 3, so the
      // raw key body would survive into `SecretHit.excerpt`.
      .replace(/\b(ghp_|sk-|AKIA)([A-Za-z0-9_-]{4,})/g, (_m, p1: string, p2: string) => {
        return `${p1}${"*".repeat(Math.min(8, p2.length))}`;
      })
      .replace(
        /(=\s*['"]?)([^\s'"]{4,})/g,
        (_m, p1: string, p2: string) => `${p1}${"*".repeat(Math.min(8, p2.length))}`,
      )
      .replace(
        /("(?:password|apiKey|api_key|secret|token|auth)"\s*:\s*")([^"]{4,})(")/gi,
        (_m, p1: string, p2: string, p3: string) =>
          `${p1}${"*".repeat(Math.min(8, p2.length))}${p3}`,
      )
  );
}

function excerptAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 8);
  const end = Math.min(text.length, index + len + 8);
  return maskSecretExcerpt(text.slice(start, end).replace(/\s+/g, " "));
}

export function scanTextForSecrets(text: string): SecretHit[] {
  if (!text) return [];
  const hits: SecretHit[] = [];
  for (const { id, re } of SECRET_PATTERNS) {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const global = new RegExp(re.source, flags);
    let match = global.exec(text);
    while (match) {
      hits.push({
        patternId: id,
        excerpt: excerptAround(text, match.index, match[0].length),
      });
      if (!global.global) break;
      match = global.exec(text);
    }
  }
  return hits;
}

export function secretsAdviseMessage(hits: SecretHit[]): string {
  const ids = [...new Set(hits.map((h) => h.patternId))].join(", ");
  return `Possible secret pattern(s) in prompt (${ids}). Cite: ${CITE}. Remove live credentials before submitting; use env vars or a secrets store.`;
}
