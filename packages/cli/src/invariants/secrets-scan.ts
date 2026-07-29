/** Prompt / text secrets scan (fail-open at hook; loud via doctor). */

export interface SecretHit {
  patternId: string;
  excerpt: string;
}

const CITE = "agent-kit guard prompt (docs/cursor-native-audit.md)";

/** Patterns aligned with pre-commit check-secrets + common prompt leaks. */
const SECRET_PATTERNS: Array<{ id: string; re: RegExp }> = [
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
  {
    id: "openai-sk",
    re: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
];

function maskSecretExcerpt(raw: string): string {
  return raw
    .replace(/\b(ghp_|sk-|AKIA)([A-Za-z0-9_]{4,})/g, (_m, p1: string, p2: string) => {
      return `${p1}${"*".repeat(Math.min(8, p2.length))}`;
    })
    .replace(
      /(=\s*['"]?)([^\s'"]{4,})/g,
      (_m, p1: string, p2: string) => `${p1}${"*".repeat(Math.min(8, p2.length))}`,
    )
    .replace(
      /("(?:password|apiKey|api_key|secret|token|auth)"\s*:\s*")([^"]{4,})(")/gi,
      (_m, p1: string, p2: string, p3: string) => `${p1}${"*".repeat(Math.min(8, p2.length))}${p3}`,
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
