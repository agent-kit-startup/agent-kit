export interface PreCompactPayload {
  context_usage_percent?: number;
  trigger?: string;
}

/**
 * Per-agent/subagent context-usage cap target (decisions/2026-08-24_agent-context-usage-cap-window-pressure.md).
 * `preCompact` only fires once the host has already decided to compact, so a
 * firing at/above this threshold — or with no reported percentage at all —
 * is treated as evidence the cap was already exceeded, not a live poll.
 */
export const CONTEXT_USAGE_CAP_PERCENT = 50;

export function buildPreCompactUserMessage(payload: PreCompactPayload = {}): {
  user_message: string;
} {
  const pct = payload.context_usage_percent;
  const trigger = payload.trigger || "auto";
  const pctTxt = pct !== undefined && pct !== null ? `~${pct}%` : "high";
  const overCap = pct === undefined || pct === null || pct >= CONTEXT_USAGE_CAP_PERCENT;
  const msg = overCap
    ? `Context compacting (${trigger}, usage ${pctTxt}) — over the ${CONTEXT_USAGE_CAP_PERCENT}% per-agent context-usage cap. Update \`.cursor/HANDOFF.md\` now (forced checkpoint) and open a new chat with \`/continue-plan\` so the next agent starts fresh.`
    : `Context compacting (${trigger}, usage ${pctTxt}). Update \`.cursor/HANDOFF.md\` and open a new chat with \`/continue-plan\` so the next agent starts fresh.`;
  return { user_message: msg };
}
