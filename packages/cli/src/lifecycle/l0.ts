/**
 * L0 core artifacts (layers-spec). Copied on `install` / refreshed on `update`
 * unless the target path is protected (L3).
 */
export interface L0Artifact {
  /** Path relative to the registry (kit) root. */
  source: string;
  /** Path relative to the project root (usually equals source for .cursor/*). */
  target: string;
}

export const L0_ARTIFACTS: readonly L0Artifact[] = [
  // Rules
  {
    source: ".cursor/rules/cursor-plan-handoff.mdc",
    target: ".cursor/rules/cursor-plan-handoff.mdc",
  },
  {
    source: ".cursor/rules/context-guardian.mdc",
    target: ".cursor/rules/context-guardian.mdc",
  },
  {
    source: ".cursor/rules/cursor-skills-git-workflow.mdc",
    target: ".cursor/rules/cursor-skills-git-workflow.mdc",
  },
  {
    source: ".cursor/rules/cursor-skills-general.mdc",
    target: ".cursor/rules/cursor-skills-general.mdc",
  },
  { source: ".cursor/rules/ux-tone.mdc", target: ".cursor/rules/ux-tone.mdc" },
  {
    source: ".cursor/rules/agent-output-hygiene.mdc",
    target: ".cursor/rules/agent-output-hygiene.mdc",
  },
  {
    source: ".cursor/rules/docs-professional-standard.mdc",
    target: ".cursor/rules/docs-professional-standard.mdc",
  },
  { source: ".cursor/rules/memory-loop.mdc", target: ".cursor/rules/memory-loop.mdc" },
  {
    source: "registry/rules/git-secrets-safety.mdc",
    target: ".cursor/rules/git-secrets-safety.mdc",
  },
  // Commands
  {
    source: ".cursor/commands/start-project.md",
    target: ".cursor/commands/start-project.md",
  },
  {
    source: ".cursor/commands/onboard.md",
    target: ".cursor/commands/onboard.md",
  },
  {
    source: ".cursor/commands/continue-plan.md",
    target: ".cursor/commands/continue-plan.md",
  },
  {
    source: ".cursor/commands/run-plan.md",
    target: ".cursor/commands/run-plan.md",
  },
  // Deprecated aliases of /run-plan (kept so existing references keep working)
  {
    source: ".cursor/commands/run-plan-loop.md",
    target: ".cursor/commands/run-plan-loop.md",
  },
  {
    source: ".cursor/commands/run-plan-orchestrated.md",
    target: ".cursor/commands/run-plan-orchestrated.md",
  },
  { source: ".cursor/commands/handoff.md", target: ".cursor/commands/handoff.md" },
  { source: ".cursor/commands/summary.md", target: ".cursor/commands/summary.md" },
  {
    source: ".cursor/commands/git-staging.md",
    target: ".cursor/commands/git-staging.md",
  },
  { source: ".cursor/commands/git-prod.md", target: ".cursor/commands/git-prod.md" },
  {
    source: ".cursor/commands/plan-external-review.md",
    target: ".cursor/commands/plan-external-review.md",
  },
  {
    source: ".cursor/commands/plan-review-triage.md",
    target: ".cursor/commands/plan-review-triage.md",
  },
  // Context (templates + example config; private config.json is not L0)
  {
    source: ".cursor/context/templates/plan-external-review-prompt.md",
    target: ".cursor/context/templates/plan-external-review-prompt.md",
  },
  {
    source: ".cursor/context/templates/plan-monitor.md",
    target: ".cursor/context/templates/plan-monitor.md",
  },
  {
    source: ".cursor/context/config.example.json",
    target: ".cursor/context/config.example.json",
  },
  // Scripts (canonical launcher; consumers never receive repo-root scripts/)
  {
    source: ".cursor/scripts/plan-external-review.sh",
    target: ".cursor/scripts/plan-external-review.sh",
  },
  // Secrets gate (structural)
  {
    source: ".cursor/hooks/pre-commit/check-secrets.sh",
    target: ".cursor/hooks/pre-commit/check-secrets.sh",
  },
  // Native Cursor agent hooks (session context + handoff on compact)
  {
    source: ".cursor/hooks.json",
    target: ".cursor/hooks.json",
  },
  {
    source: ".cursor/hooks/agent/session-plan-guard.py",
    target: ".cursor/hooks/agent/session-plan-guard.py",
  },
  {
    source: ".cursor/hooks/agent/precompact-handoff.py",
    target: ".cursor/hooks/agent/precompact-handoff.py",
  },
  // Git spine docs at project root (not a nested agent-kit/ copy)
  {
    source: "autogit/gitupdate.md",
    target: "autogit/gitupdate.md",
  },
  {
    source: "autogit/plan-routine.md",
    target: "autogit/plan-routine.md",
  },
];
