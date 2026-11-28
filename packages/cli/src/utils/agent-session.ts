/**
 * Agent-session detection for operator-only commands (`update --all`,
 * ADR 2026-11-26_update-all-operator-only-branch-mr-per-repo point 1).
 *
 * A marker here means the process runs under an agent or a headless kit run,
 * not under an operator's own keystrokes. `COLONY_HOST_CLI` is deliberately
 * absent: Colony also exports it into the operator's own terminal tabs.
 */

import { CLAUDE_NESTED_SESSION_KEYS } from "../plan-loop/backends.js";
import { QUEUE_LEASE_SESSION_ENV } from "../plan-loop/queue-lease.js";

/** Set by the kit on headless children (external review, plan-loop spawns). */
export const AGENT_KIT_HEADLESS_ENV = "AGENT_KIT_HEADLESS";

/**
 * Env markers of an agent session, each with the label printed in a refusal.
 * Claude Code exports the nested-session keys into every shell it runs;
 * Cursor exports `CURSOR_AGENT` into agent-run terminals; the kit exports
 * the queue-lease session to the agent child of `run-plan-all`.
 */
export const AGENT_SESSION_MARKERS: readonly { key: string; label: string }[] = [
  ...CLAUDE_NESTED_SESSION_KEYS.map((key) => ({ key, label: "Claude Code agent session" })),
  { key: "CURSOR_AGENT", label: "Cursor agent session" },
  { key: AGENT_KIT_HEADLESS_ENV, label: "headless Agent Kit run" },
  { key: QUEUE_LEASE_SESSION_ENV, label: "Agent Kit plan loop" },
];

function markerSet(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false";
}

/** The first agent-session marker set in `env`, or null when none is. */
export function detectAgentSession(
  env: NodeJS.ProcessEnv = process.env,
): { key: string; label: string } | null {
  for (const marker of AGENT_SESSION_MARKERS) {
    if (markerSet(env[marker.key])) return marker;
  }
  return null;
}

export interface OperatorTerminalProbe {
  env?: NodeJS.ProcessEnv;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}

/**
 * One-line reason `command` refuses to run here, or null when an operator is
 * typing it in a terminal. `--yes`, `AGENT_KIT_YES` and `CI` never lift it.
 */
export function operatorOnlyRefusal(
  command: string,
  probe: OperatorTerminalProbe = {},
): string | null {
  const agent = detectAgentSession(probe.env ?? process.env);
  if (agent) {
    return `${command} is operator-only and refuses inside an agent session (${agent.label}: ${agent.key} is set); type it in your own terminal.`;
  }
  const stdinTTY = probe.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const stdoutTTY = probe.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  if (!stdinTTY || !stdoutTTY) {
    return `${command} is operator-only and needs an interactive terminal (stdin and stdout must be a TTY); type it in your own terminal.`;
  }
  return null;
}
