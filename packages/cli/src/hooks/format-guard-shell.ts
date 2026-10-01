import type { ShellGuardResult } from "../invariants/shell-guard.js";

/**
 * `guard shell` hook I/O shared by both consumer hosts.
 *
 * Cursor's beforeShellExecution adapter sends `{command, cwd}` on stdin and
 * reads `JSON.stringify(ShellGuardResult)` from stdout — that shape is
 * unchanged here.
 *
 * Claude Code's PreToolUse(Bash) hook sends `{session_id, cwd,
 * hook_event_name, tool_name, tool_input: {command}}` on stdin (live docs,
 * code.claude.com/docs/en/hooks, "PreToolUse input"). A deny is the JSON
 * `hookSpecificOutput` with `permissionDecision: "deny"` on exit 0; an allow is
 * empty stdout, so Claude Code's own permission flow still runs (emitting
 * `"allow"` would bypass it). ADR 2026-08-13_claude-cli-kit-load-bootstrap,
 * Amend (2026-09-27).
 */

export type GuardShellHookFormat = "cursor" | "claude";

export interface GuardShellInput {
  command: string;
  cwd?: string;
}

/** Unknown/omitted values fall back to `cursor` (default unchanged). */
export function resolveGuardShellFormat(value: unknown): GuardShellHookFormat {
  return value === "claude" ? "claude" : "cursor";
}

/**
 * claude: `tool_input.command` only. No fallback to a top-level `command`:
 * PreToolUse never sends one, and falling back would let a crafted payload
 * shadow the command Claude Code is about to run.
 */
export function extractGuardShellInput(
  payload: unknown,
  format: GuardShellHookFormat,
): GuardShellInput {
  const p = (payload && typeof payload === "object" ? payload : {}) as {
    command?: unknown;
    cwd?: unknown;
    tool_input?: { command?: unknown } | null;
  };
  const cwd = typeof p.cwd === "string" && p.cwd ? p.cwd : undefined;
  if (format === "claude") {
    const command = typeof p.tool_input?.command === "string" ? p.tool_input.command : "";
    return { command, cwd };
  }
  const command = typeof p.command === "string" ? p.command : "";
  return { command, cwd };
}

export function formatGuardShellOutput(
  result: ShellGuardResult,
  format: GuardShellHookFormat,
): string {
  if (format !== "claude") return JSON.stringify(result);
  if (result.permission !== "deny") return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        result.agent_message ??
        `Denied by agent-kit guard shell (rule \`${result.rule ?? "unknown"}\`).`,
    },
  });
}
