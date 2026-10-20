/**
 * Claude Code native permission backstops (deny rules). Deny wins across
 * every settings scope and over `--dangerously-skip-permissions`. `install --claude`
 * also wires `agent-kit guard shell --format claude` as a PreToolUse(Bash) hook
 * (interactive verified; headless enforcement pending smoke), so these rows plus
 * `git-hooks/pre-push` stay a best-effort backstop, not a parser:
 * globs cannot follow every refspec or option spelling (e.g. `-uf`). The rows
 * cover main/master refspec shapes, `--force`/leading `-f`, `+` force refspecs,
 * `--no-verify` (and its unique prefixes), and any git global option before a
 * ` push` token (also denies e.g. `git -c x commit -m "push ..."`; fail-closed).
 *
 * - HEADLESS_DENY_RULES: appended as `--disallowedTools` by
 *   `claudeHeadlessArgs` (plan-loop/backends.ts). Also blocks the inline
 *   `ALLOW_MAIN_PUSH=` authorization and the promote skills, because a
 *   headless tick or `agent-kit run` never runs /git-prod. Also blocks
 *   Edit/Write on the hook files, `.claude/settings.json` and the built CLI
 *   so a headless tick cannot disable the fail-open guard.
 * - INTERACTIVE_DENY_RULES: merged into `.claude/settings.json`
 *   `permissions.deny`. Keeps attended /git-prod working: its authorized
 *   `ALLOW_MAIN_PUSH=1 git push origin main` and the Skill rows stay allowed.
 * - INTERACTIVE_ALLOW_RULES: merged into `permissions.allow` (same ledger rules).
 */

/** Rows shared by both modes: plain main/master pushes and force pushes. */
const SHARED_DENY_RULES = [
  "Bash(git push * main)",
  "Bash(git push * main *)",
  "Bash(git push *:main*)",
  "Bash(git push *+main*)",
  "Bash(git push *refs/heads/main*)",
  "Bash(git push * master)",
  "Bash(git push * master *)",
  "Bash(git push *:master*)",
  "Bash(git push *+master*)",
  "Bash(git push *refs/heads/master*)",
  "Bash(git push * @)",
  "Bash(git push --force*)",
  "Bash(git push * --force*)",
  "Bash(git push -f*)",
  "Bash(git push * -f*)",
  "Bash(git push *--no-veri*)",
  "Bash(git push * +*)",
  // Any git global option before a push token (-C, -c, -P, --no-pager, --config-env, ...).
  "Bash(git -* push*)",
] as const;

/**
 * Headless-only rows: the attended /git-prod authorization, the promote skills,
 * and self-neutralization of the fail-open guard (a headless tick must not edit
 * the hook wiring, the settings file, or the built CLI the hook resolves).
 */
export const HEADLESS_ONLY_DENY_RULES = [
  "Bash(ALLOW_MAIN_PUSH=*)",
  "Skill(git-prod)",
  "Skill(kit-prod)",
  "Edit(.cursor/hooks/**)",
  "Write(.cursor/hooks/**)",
  "Edit(.claude/settings.json)",
  "Write(.claude/settings.json)",
  "Edit(packages/cli/dist/**)",
  "Write(packages/cli/dist/**)",
] as const;

export const HEADLESS_DENY_RULES: readonly string[] = [
  ...SHARED_DENY_RULES,
  ...HEADLESS_ONLY_DENY_RULES,
];

export const INTERACTIVE_DENY_RULES: readonly string[] = [...SHARED_DENY_RULES];

/**
 * Interactive allow rows: the /git-staging merge step. Narrow rules resolve before
 * the auto-mode classifier, so the kit routine, not the classifier, decides the
 * staging merge; auto mode already allows the push and the PR creation. The
 * PreToolUse guard still denies a merge whose base is main/master/prod or cannot be
 * resolved (shell-guard.ts `pr-merge-protected-base`), and /git-prod never merges
 * into main from the agent. Headless ticks need no row (`--dangerously-skip-permissions`).
 * ADR 2026-08-13_claude-cli-kit-load-bootstrap.md, Amend (2026-10-19).
 */
export const INTERACTIVE_ALLOW_RULES: readonly string[] = [
  "Bash(gh pr merge)",
  "Bash(gh pr merge *)",
  "Bash(glab mr merge)",
  "Bash(glab mr merge *)",
];
