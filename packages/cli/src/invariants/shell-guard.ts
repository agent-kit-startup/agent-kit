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

const CITE = "agent-kit guard shell (ADR 2026-07-29_cli-invariants-thin-hook-adapters)";

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

/** Ordered deny rules: first match wins. Exported for vitest parity with hooks. */
export const SHELL_DENY_RULES: Array<{
  id: string;
  description: string;
  test: (command: string) => boolean;
}> = [
  {
    id: "git-checkout-path",
    description: "git checkout -- <paths> discards working-tree edits",
    test: (cmd) => anyHeadMatches(cmd, /^(?:[\w./-]+\/)?git\s+checkout\s+--(?:\s|$)/),
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
    test: (cmd) =>
      shellInvocationHeads(cmd).some((head) => {
        if (!/^(?:[\w./-]+\/)?git\s+push\b/.test(head)) return false;
        return (
          /(?:^|\s)(?:origin\/)?(?:main|master|prod)(?:\s|$|:)/.test(head) ||
          /HEAD:(?:refs\/heads\/)?(?:main|master|prod)\b/.test(head) ||
          /(?:^|\s)-(?:u|--set-upstream)\s+\S+\s+(?:main|master|prod)(?:\s|$)/.test(head)
        );
      }),
  },
];

export function evaluateShellCommand(command: string): ShellGuardResult {
  const normalized = normalizeShellCommand(command);
  if (!normalized) {
    return { permission: "allow" };
  }
  for (const rule of SHELL_DENY_RULES) {
    if (rule.test(normalized)) {
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
