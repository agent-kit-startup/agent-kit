/** Destructive shell / push-to-main deny-list (CLI SoT; thin beforeShellExecution adapter). */

export type ShellPermission = "allow" | "deny";

export interface ShellGuardResult {
  permission: ShellPermission;
  /** Message for the agent when denied (cites canonical path). */
  agent_message?: string;
  /** Optional operator-visible note. */
  user_message?: string;
  /** Matched rule id when denied. */
  rule?: string;
}

export interface ShellGuardOptions {
  /** Current git branch (abbrev-ref). Used for bare / HEAD pushes. */
  currentBranch?: string | null;
}

const CITE = "agent-kit guard shell (ADR 2026-07-29_cli-invariants-thin-hook-adapters)";

const PROTECTED_BRANCH_RE = /^(?:main|master|prod)$/;

/** Collapse whitespace / newlines so multiline shell payloads still match. */
export function normalizeShellCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

/**
 * Split into shell segments and strip leading env assignments so
 * `node … --command "git checkout -- x"` does not false-positive.
 */
export function shellInvocationHeads(command: string): string[] {
  const normalized = normalizeShellCommand(command);
  if (!normalized) return [];
  return normalized
    .split(/(?:&&|\|\||[;|])/)
    .map((part) => part.trim().replace(/^(?:\w+=\S+\s+)*/, ""))
    .filter(Boolean);
}

function anyHeadMatches(command: string, re: RegExp): boolean {
  return shellInvocationHeads(command).some((head) => re.test(head));
}

function isProtectedBranch(name: string | null | undefined): boolean {
  return typeof name === "string" && PROTECTED_BRANCH_RE.test(name.trim());
}

/**
 * Strip surrounding quotes, force `+`, and `refs/heads/` so protected-name checks see bare branch names.
 * Closes `git push origin +main` / `refs/heads/main` / `'main'` / `"+main"` bypasses.
 */
export function normalizePushRefspecToken(token: string): string {
  let t = token.trim();
  // Shell-quoted refspecs (`'main'`, `"+main"`) must normalize before + / refs/heads/.
  if (
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2) ||
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2)
  ) {
    t = t.slice(1, -1).trim();
  }
  if (t.startsWith("+")) t = t.slice(1);
  if (t.startsWith("refs/heads/")) t = t.slice("refs/heads/".length);
  if (t.startsWith("origin/")) t = t.slice("origin/".length);
  return t;
}

/** Protected push destination after refspec normalization (+ / refs/heads/). */
function pushHeadHasProtectedDest(head: string): boolean {
  if (/HEAD:(?:refs\/heads\/)?(?:main|master|prod)\b/.test(head)) return true;
  if (/(?:^|\s)-(?:u|--set-upstream)\s+\S+\s+(?:main|master|prod)(?:\s|$)/.test(head)) {
    return true;
  }
  const after = head.replace(/^(?:[\w./-]+\/)?git\s+push\b/, "");
  for (const raw of after.split(/\s+/).filter(Boolean)) {
    if (raw.startsWith("-")) continue;
    const dest = raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw;
    if (PROTECTED_BRANCH_RE.test(normalizePushRefspecToken(dest))) return true;
  }
  return false;
}

/** True when push has no explicit non-protected branch destination. */
function isBareOrHeadPushToCurrent(head: string): boolean {
  if (!/^(?:[\w./-]+\/)?git\s+push\b/.test(head)) return false;
  // Explicit protected destination already handled by git-push-main.
  if (pushHeadHasProtectedDest(head)) {
    return false;
  }
  // Explicit safe branch → allow
  if (
    /(?:^|\s)\+?(?:refs\/heads\/)?(?:origin\/)?(?:staging|develop|homologacao)(?:\s|$|:)/.test(
      head,
    ) ||
    /HEAD:(?:refs\/heads\/)?(?!main|master|prod)[A-Za-z0-9._/-]+/.test(head)
  ) {
    return false;
  }
  const after = head.replace(/^(?:[\w./-]+\/)?git\s+push\b/, "").trim();
  const withoutFlags = after
    .replace(/(?:^|\s)(?:--force|-f|-u|--set-upstream|--tags|--all|--prune)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)--\w[\w-]*(?:=\S+)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutFlags) return true; // bare git push / git push --force
  const tokens = withoutFlags.split(/\s+/);
  // remote only (origin) or remote + HEAD
  if (tokens.length === 1) return true;
  if (tokens.length >= 2 && tokens[1] === "HEAD") return true;
  if (/\bHEAD\b/.test(withoutFlags) && !/HEAD:/.test(withoutFlags)) return true;
  return false;
}

/** Ordered deny rules: first match wins. Exported for vitest parity with hooks. */
export const SHELL_DENY_RULES: Array<{
  id: string;
  description: string;
  test: (command: string, opts?: ShellGuardOptions) => boolean;
}> = [
  {
    id: "git-checkout-path",
    description: "git checkout -- / HEAD -- / . discards working-tree edits",
    test: (cmd) =>
      shellInvocationHeads(cmd).some((head) => {
        if (!/^(?:[\w./-]+\/)?git\s+checkout\b/.test(head)) return false;
        // git checkout -- <paths> OR git checkout <ref> -- <paths>
        if (/\s--(?:\s|$)/.test(head)) return true;
        // git checkout .
        if (/\scheckout\s+\.(?:\s|$)/.test(head)) return true;
        return false;
      }),
  },
  {
    id: "git-restore",
    description: "git restore discards working-tree edits",
    test: (cmd) => anyHeadMatches(cmd, /^(?:[\w./-]+\/)?git\s+restore\b/),
  },
  {
    id: "git-reset-hard",
    description: "git reset --hard destroys uncommitted work",
    test: (cmd) => anyHeadMatches(cmd, /^(?:[\w./-]+\/)?git\s+reset\b.*--hard\b/),
  },
  {
    id: "git-clean-fd",
    description: "git clean -fd removes untracked files",
    test: (cmd) =>
      shellInvocationHeads(cmd).some(
        (head) =>
          /^(?:[\w./-]+\/)?git\s+clean\b/.test(head) &&
          /(?:^|\s)-(?:[a-z]*f[a-z]*d|[a-z]*d[a-z]*f)(?:\s|$)/.test(head),
      ),
  },
  {
    id: "git-push-main",
    description: "direct push to main/master/prod bypasses staging",
    test: (cmd, opts) =>
      shellInvocationHeads(cmd).some((head) => {
        if (!/^(?:[\w./-]+\/)?git\s+push\b/.test(head)) return false;
        if (pushHeadHasProtectedDest(head)) {
          return true;
        }
        // Bare / HEAD push while checked out on a protected branch
        if (isProtectedBranch(opts?.currentBranch) && isBareOrHeadPushToCurrent(head)) {
          return true;
        }
        return false;
      }),
  },
];

export function evaluateShellCommand(
  command: string,
  opts: ShellGuardOptions = {},
): ShellGuardResult {
  const normalized = normalizeShellCommand(command);
  if (!normalized) {
    return { permission: "allow" };
  }
  for (const rule of SHELL_DENY_RULES) {
    if (rule.test(normalized, opts)) {
      const agent_message = `Denied by ${CITE}: ${rule.description} (rule \`${rule.id}\`). Use /git-staging; never discard human hunks or push protected branches from the agent.`;
      return {
        permission: "deny",
        rule: rule.id,
        agent_message,
        user_message: agent_message,
      };
    }
  }
  return { permission: "allow" };
}
