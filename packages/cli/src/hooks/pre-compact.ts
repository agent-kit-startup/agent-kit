export interface PreCompactPayload {
  context_usage_percent?: number;
  trigger?: string;
}

export function buildPreCompactUserMessage(payload: PreCompactPayload = {}): {
  user_message: string;
} {
  const pct = payload.context_usage_percent;
  const trigger = payload.trigger || "auto";
  const pctTxt = pct !== undefined && pct !== null ? `~${pct}%` : "high";
  const msg = `Context compacting (${trigger}, usage ${pctTxt}). Update \`.cursor/HANDOFF.md\` and open a new chat with \`/continue-plan\` so the next agent starts fresh.`;
  return { user_message: msg };
}
