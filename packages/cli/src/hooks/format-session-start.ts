/**
 * sessionStart hook output formatting shared by both consumer hosts.
 *
 * Cursor's adapter (`.cursor/hooks/agent/session-start.sh`) expects stdout as
 * `{"additional_context": "..."}` JSON — that shape is unchanged here.
 *
 * Claude Code's SessionStart hook accepts plain stdout text directly as
 * session context; no JSON wrapper is required (live docs,
 * code.claude.com/docs/en/hooks, "SessionStart": "For UserPromptSubmit,
 * UserPromptExpansion, and SessionStart... Claude Code adds plain-text stdout
 * as context that Claude can see and act on" — the simplest of the two
 * documented shapes, the other being `hookSpecificOutput.additionalContext`
 * JSON). Emitting plain text CLI-side for `--format claude` means the
 * consumer `.claude/settings.json` command needs no `node -e` JSON-unwrapper:
 * `agent-kit hook session-start --format claude` is directly consumable.
 */

export type SessionStartHookFormat = "cursor" | "claude";

/** Unknown/omitted values fall back to `cursor` (default unchanged). */
export function resolveSessionStartFormat(value: unknown): SessionStartHookFormat {
  return value === "claude" ? "claude" : "cursor";
}

export function formatSessionStartOutput(
  additionalContext: string,
  format: SessionStartHookFormat,
): string {
  if (format === "claude") return additionalContext;
  return JSON.stringify({ additional_context: additionalContext });
}

/**
 * Fail-open diagnostic parity with the Cursor sessionStart adapter
 * (docs/marketplace.md, "Hook resolution boundary"): sessionStart is the one
 * hook surface that can carry text into the session, so this command must
 * never throw a non-zero exit even on an unexpected internal failure. The
 * *content* differs from Cursor's CLI-unresolved diagnostic on purpose — that
 * failure mode (agent-kit not resolvable at all) is a shell-level concern
 * handled by the consumer's own command line, not by this already-running
 * process — but the guarantee is identical: fail-open, exit 0, session start
 * is never blocked.
 */
export const SESSION_START_DEGRADED_MESSAGE =
  "Agent Kit session-start context is unavailable this session (internal error, fail-open mode). Nothing else is affected; retry next session.";
