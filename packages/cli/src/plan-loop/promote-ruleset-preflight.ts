/**
 * Promote preflight: read the branch rules that apply to the promote base
 * (`gh api repos/<owner>/<repo>/rules/branches/<base>`) and name every rule
 * parameter the kit has no model for.
 *
 * GitHub can refuse a merge for a ruleset reason while `gh` reports
 * `MERGEABLE`/`CLEAN` and every check is green; the merge-state fields do not
 * name the rule (PR #1386, 2026-11-02:
 * `pull_request.require_extra_approval_for_unattributed_changes: true`).
 * Advisory only: any failure (no `gh`, no auth, offline, API error) is one
 * note line, never a block.
 */

export type BranchRule = {
  type: string;
  parameters?: Record<string, unknown>;
  rulesetId?: number;
};

/** Rule types whose meaning the promote routine handles (PR-only base, no force push, required checks). */
export const MODELED_RULE_TYPES: ReadonlySet<string> = new Set([
  "deletion",
  "non_fast_forward",
  "pull_request",
  "required_status_checks",
]);

/**
 * Parameters the kit models, with the values it handles. The promote PR is
 * merged by the operator with no second reviewer, so a nonzero approval count
 * is not handled. Any parameter outside this table is printed when its value
 * restricts the merge (true, a nonzero number, a non-empty list or string).
 */
export const MODELED_RULE_PARAMETERS: Readonly<Record<string, (value: unknown) => boolean>> = {
  "pull_request.required_approving_review_count": (v) => v === 0,
  "pull_request.allowed_merge_methods": () => true,
  "pull_request.dismiss_stale_reviews_on_push": () => true,
  "required_status_checks.required_status_checks": () => true,
  "required_status_checks.strict_required_status_checks_policy": () => true,
  "required_status_checks.do_not_enforce_on_create": () => true,
};

export type UnmodeledRuleParameter = {
  /** `<rule type>.<parameter>`, or the bare rule type for an unmodeled rule. */
  name: string;
  value?: unknown;
  rulesetId?: number;
};

export type RulesetPreflight = { ok: true; rules: BranchRule[] } | { ok: false; note: string };

/** Parse the `rules/branches/<base>` array; null when it is not one. */
export function parseBranchRules(json: string): BranchRule[] | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const rules: BranchRule[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (typeof o.type !== "string" || !o.type) return null;
    const rule: BranchRule = { type: o.type };
    if (o.parameters && typeof o.parameters === "object" && !Array.isArray(o.parameters)) {
      rule.parameters = o.parameters as Record<string, unknown>;
    }
    if (typeof o.ruleset_id === "number") rule.rulesetId = o.ruleset_id;
    rules.push(rule);
  }
  return rules;
}

function restricts(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

/** Unmodeled rule types, plus parameters outside the model (or outside its handled values). */
export function findUnmodeledRuleParameters(
  rules: readonly BranchRule[],
): UnmodeledRuleParameter[] {
  const out: UnmodeledRuleParameter[] = [];
  const seen = new Set<string>();
  const push = (u: UnmodeledRuleParameter) => {
    const key = `${u.name}@${u.rulesetId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(u);
  };
  for (const rule of rules) {
    if (!MODELED_RULE_TYPES.has(rule.type)) {
      push({ name: rule.type, rulesetId: rule.rulesetId });
      continue;
    }
    for (const [param, value] of Object.entries(rule.parameters ?? {})) {
      const name = `${rule.type}.${param}`;
      const handled = MODELED_RULE_PARAMETERS[name];
      const unmodeled = handled ? !handled(value) : restricts(value);
      if (unmodeled) push({ name, value, rulesetId: rule.rulesetId });
    }
  }
  return out;
}

/** Advisory text: one line per unmodeled parameter, one ok line, or one note line. */
export function formatRulesetPreflight(base: string, result: RulesetPreflight): string {
  if (!result.ok) {
    return `ruleset preflight (${base}): skipped (${result.note}); advisory only, not a blocker.\n`;
  }
  const unmodeled = findUnmodeledRuleParameters(result.rules);
  if (unmodeled.length === 0) {
    return `ruleset preflight (${base}): every rule parameter is modeled by the kit.\n`;
  }
  return `${unmodeled
    .map((u) => {
      const value = u.value === undefined ? "" : ` = ${JSON.stringify(u.value)}`;
      const ruleset = u.rulesetId === undefined ? "" : ` (ruleset ${u.rulesetId})`;
      return `ruleset advisory (${base}): ${u.name}${value}${ruleset} has no model in the kit; GitHub may refuse the merge while it reports CLEAN.`;
    })
    .join("\n")}\n`;
}

export type GhApiRunner = (args: string[]) => Promise<string>;

function failureNote(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "ENOENT") return "gh not found";
  const msg = err instanceof Error ? err.message : String(err);
  const first = msg.split(/\r?\n/).find((l) => l.trim()) ?? "gh api failed";
  return first.trim().slice(0, 200);
}

/** Read the base branch rules with `gh api`. Never throws. */
export async function rulesetPreflightFromGh(opts: {
  base: string;
  repo?: string;
  runGh: GhApiRunner;
}): Promise<RulesetPreflight> {
  const repo = opts.repo ?? "{owner}/{repo}";
  let stdout: string;
  try {
    stdout = await opts.runGh([
      "api",
      `repos/${repo}/rules/branches/${encodeURIComponent(opts.base)}`,
    ]);
  } catch (err) {
    return { ok: false, note: failureNote(err) };
  }
  const rules = parseBranchRules(stdout);
  if (!rules) return { ok: false, note: "unreadable rules response" };
  return { ok: true, rules };
}
