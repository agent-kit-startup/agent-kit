/**
 * Git-workflow / protected-branch deny-list (CLI SoT; thin beforeShellExecution adapter).
 *
 * Scope is deliberately git-only (ADR `2026-07-29_cli-invariants-thin-hook-adapters`): the
 * guard protects human working-tree hunks and protected branches. It is NOT a general
 * destructive-command guard — `rm -rf /`, `chmod -R 777 /`, `dd …` return `allow`. Do not
 * describe it as one; widening the scope is a separate, deliberate plan.
 */

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

/** Split on shell combinators; keeps leading `ENV=val` on each segment. */
export function shellSegments(command: string): string[] {
  const normalized = normalizeShellCommand(command);
  if (!normalized) return [];
  return normalized
    .split(/(?:&&|\|\||[;|])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Strip leading env assignments from a single segment so
 * `node … --command "git checkout -- x"` does not false-positive.
 */
export function stripLeadingEnvAssignments(segment: string): string {
  return segment.replace(/^(?:\w+=\S+\s+)*/, "");
}

/**
 * Split into shell segments and strip leading env assignments so
 * `node … --command "git checkout -- x"` does not false-positive.
 */
export function shellInvocationHeads(command: string): string[] {
  return shellSegments(command).map(stripLeadingEnvAssignments).filter(Boolean);
}

/** True when ALLOW_MAIN_PUSH=1 is set inline on the segment or in process.env. */
function segmentHasAllowMainPushEnv(segment: string): boolean {
  if (process.env.ALLOW_MAIN_PUSH === "1") return true;
  const leading = segment.match(/^(?:\w+=\S+\s+)*/)?.[0] ?? "";
  return /(?:^|\s)ALLOW_MAIN_PUSH=1(?:\s|$)/.test(leading);
}

/** Flags that must never ride with an authorized /git-prod main push. */
function hasForbiddenMainPushFlags(head: string): boolean {
  for (const t of head.split(/\s+/).filter(Boolean)) {
    if (
      t === "--force" ||
      t === "-f" ||
      t === "--force-with-lease" ||
      t === "--no-verify" ||
      t === "--all" ||
      t === "--tags"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Documented /git-prod push shapes only: `git push <remote> main` or
 * `git push <remote> HEAD:main` (optional refs/heads/ on dest). No force
 * refspec, no master/prod, no forbidden flags.
 */
function isAuthorizedProdMainPush(head: string): boolean {
  if (!/^(?:[\w./-]+\/)?git\s+push\b/.test(head)) return false;
  if (hasForbiddenMainPushFlags(head)) return false;

  const after = head.replace(/^(?:[\w./-]+\/)?git\s+push\b/, "").trim();
  const positional: string[] = [];
  for (const t of after.split(/\s+/).filter(Boolean)) {
    if (t.startsWith("-")) continue;
    positional.push(t);
  }
  // Documented forms are exactly <remote> <refspec>.
  const refspec = positional.length === 2 ? positional[1] : undefined;
  if (!refspec) return false;

  const unquoted = refspec.replace(/['"\\]/g, "");
  if (unquoted.startsWith("+")) return false;

  if (unquoted.includes(":")) {
    const src = unquoted.slice(0, unquoted.lastIndexOf(":"));
    if (src !== "HEAD") return false;
  }

  const dest = unquoted.includes(":") ? unquoted.slice(unquoted.lastIndexOf(":") + 1) : unquoted;
  return normalizePushRefspecToken(dest) === "main";
}

/**
 * True when this segment authorizes the documented /git-prod main push.
 * Requires ALLOW_MAIN_PUSH=1 (inline or process.env) *and* an authorized
 * shape; env alone must not bypass force / --no-verify / master / prod / --all|--tags.
 * Must see env before strip: `shellInvocationHeads` removes `ALLOW_MAIN_PUSH=1`.
 */
export function segmentAllowsMainPush(segment: string): boolean {
  if (!segmentHasAllowMainPushEnv(segment)) return false;
  return isAuthorizedProdMainPush(stripLeadingEnvAssignments(segment));
}

function anyHeadMatches(command: string, re: RegExp): boolean {
  return shellInvocationHeads(command).some((head) => re.test(head));
}

function isProtectedBranch(name: string | null | undefined): boolean {
  return typeof name === "string" && PROTECTED_BRANCH_RE.test(name.trim());
}

/**
 * Delete all quote chars, backslashes, force `+`, and `refs/heads/` so protected-name
 * checks see bare branch names.
 * Closes surrounding (`'main'`, `"+main"`), prefixed (`+'main'`), embedded (`ma'in'`),
 * and shell-collapse backslash forms (`\main`, `ma\in`, `mai\n`).
 * Refnames containing quotes/backslashes are pathological; over-blocking risk is negligible.
 */
export function normalizePushRefspecToken(token: string): string {
  let t = token.trim();
  // Shell quote/backslash forms collapse to the same dest; strip before + / refs/heads/.
  t = t.replace(/['"\\]/g, "");
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
      shellSegments(cmd).some((segment) => {
        // Authorized /git-prod path (parity with git-hooks/pre-push).
        if (segmentAllowsMainPush(segment)) return false;
        const head = stripLeadingEnvAssignments(segment);
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
