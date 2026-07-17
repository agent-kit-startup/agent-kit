/**
 * Entry gate for upstream contributions (anti-slop + hygiene).
 * Rejects secrets, session/metalinguage noise, and oversized dumps.
 */

export interface GateIssue {
  code: string;
  message: string;
}

export interface GateResult {
  ok: boolean;
  issues: GateIssue[];
}

const SECRET_PATTERNS: readonly { code: string; re: RegExp; message: string }[] = [
  {
    code: "secret-aws",
    re: /AKIA[0-9A-Z]{16}/,
    message: "Looks like an AWS access key id",
  },
  {
    code: "secret-private-key",
    re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
    message: "Contains a private key block",
  },
  {
    code: "secret-bearer",
    re: /(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"][^'"]{12,}['"]/i,
    message: "Looks like an inline API key / token / password",
  },
  {
    code: "secret-github-pat",
    re: /\bghp_[A-Za-z0-9]{20,}\b/,
    message: "Looks like a GitHub personal access token",
  },
];

const HYGIENE_PATTERNS: readonly { code: string; re: RegExp; message: string }[] = [
  {
    code: "meta-agent",
    re: /\b(como IA|as an AI|no meu racioc[ií]nio|vou usar a tool|contexto do chat)\b/i,
    message: "Agent metalinguage — not allowed in versioned kit artifacts",
  },
  {
    code: "session-transient",
    re: /\b(conforme falamos|no chat anterior|WIP do agente|hoje eu configurei)\b/i,
    message: "Session / chat-transient wording — rewrite in project voice",
  },
];

/** Paths that must never be proposed upstream (L3 / session). */
const BLOCKED_PATH_GLOBS: readonly RegExp[] = [
  /^\.cursor\/HANDOFF\.md$/i,
  /^\.cursor\/plans\//i,
  /^\.cursor\/memory\//i,
  /^\.cursor\/context\//i,
  /^\.env/i,
  /(^|\/)credentials?\./i,
  /(^|\/)secrets?\./i,
];

const MAX_BYTES = 200_000;

export function gateContributePath(projectRel: string): GateIssue[] {
  const posix = projectRel.split("\\").join("/");
  const issues: GateIssue[] = [];
  for (const re of BLOCKED_PATH_GLOBS) {
    if (re.test(posix)) {
      issues.push({
        code: "path-blocked",
        message: `Path is session/L3 or secret-like — cannot contribute: ${posix}`,
      });
    }
  }
  return issues;
}

export function gateContributeContent(content: string, projectRel: string): GateResult {
  const issues: GateIssue[] = [...gateContributePath(projectRel)];
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_BYTES) {
    issues.push({
      code: "too-large",
      message: `File too large (${bytes} bytes; max ${MAX_BYTES})`,
    });
  }
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(content)) issues.push({ code: p.code, message: p.message });
  }
  for (const p of HYGIENE_PATTERNS) {
    if (p.re.test(content)) issues.push({ code: p.code, message: p.message });
  }
  return { ok: issues.length === 0, issues };
}
