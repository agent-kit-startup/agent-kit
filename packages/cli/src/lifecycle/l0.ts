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
    source: ".cursor/rules/hitl-ask-questions.mdc",
    target: ".cursor/rules/hitl-ask-questions.mdc",
  },
  {
    source: ".cursor/skills/core/hitl-gates/SKILL.md",
    target: ".cursor/skills/core/hitl-gates/SKILL.md",
  },
  {
    source: ".cursor/skills/core/hitl-gates/procedures.md",
    target: ".cursor/skills/core/hitl-gates/procedures.md",
  },
  {
    source: ".cursor/skills/core/hitl-gates/run-plan-tick-contract.md",
    target: ".cursor/skills/core/hitl-gates/run-plan-tick-contract.md",
  },
  {
    source: ".cursor/skills/core/hitl-gates/start-project-intake.md",
    target: ".cursor/skills/core/hitl-gates/start-project-intake.md",
  },
  {
    source: ".cursor/skills/core/hitl-gates/run-plan-all-queue.md",
    target: ".cursor/skills/core/hitl-gates/run-plan-all-queue.md",
  },
  {
    source: ".cursor/skills/core/qa/SKILL.md",
    target: ".cursor/skills/core/qa/SKILL.md",
  },
  {
    source: ".cursor/skills/core/dashboard-broadcast/SKILL.md",
    target: ".cursor/skills/core/dashboard-broadcast/SKILL.md",
  },
  {
    source: ".cursor/skills/core/plan-review-triage/procedure.md",
    target: ".cursor/skills/core/plan-review-triage/procedure.md",
  },
  {
    source: ".cursor/skills/core/plan-external-review/procedure.md",
    target: ".cursor/skills/core/plan-external-review/procedure.md",
  },
  {
    source: ".cursor/skills/core/agent-kit-onboard/procedure.md",
    target: ".cursor/skills/core/agent-kit-onboard/procedure.md",
  },
  {
    source: ".cursor/skills/core/field-report-resolve/procedure.md",
    target: ".cursor/skills/core/field-report-resolve/procedure.md",
  },
  {
    source: ".cursor/skills/core/backlog-add/procedure.md",
    target: ".cursor/skills/core/backlog-add/procedure.md",
  },
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
    source: ".cursor/commands/backlog-add.md",
    target: ".cursor/commands/backlog-add.md",
  },
  {
    source: ".cursor/commands/backlog-edit.md",
    target: ".cursor/commands/backlog-edit.md",
  },
  {
    source: ".cursor/commands/backlog-delete.md",
    target: ".cursor/commands/backlog-delete.md",
  },
  {
    source: ".cursor/commands/backlog-cancel.md",
    target: ".cursor/commands/backlog-cancel.md",
  },
  {
    source: ".cursor/commands/agent-kit-onboard.md",
    target: ".cursor/commands/agent-kit-onboard.md",
  },
  {
    source: ".cursor/commands/continue-plan.md",
    target: ".cursor/commands/continue-plan.md",
  },
  {
    source: ".cursor/commands/run-plan.md",
    target: ".cursor/commands/run-plan.md",
  },
  {
    source: ".cursor/commands/hotfix.md",
    target: ".cursor/commands/hotfix.md",
  },
  {
    source: ".cursor/commands/run-plan-all.md",
    target: ".cursor/commands/run-plan-all.md",
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
    source: ".cursor/commands/dashboard.md",
    target: ".cursor/commands/dashboard.md",
  },
  {
    source: ".cursor/commands/dashboard-broadcast.md",
    target: ".cursor/commands/dashboard-broadcast.md",
  },
  {
    source: ".cursor/commands/git-staging.md",
    target: ".cursor/commands/git-staging.md",
  },
  { source: ".cursor/commands/git-prod.md", target: ".cursor/commands/git-prod.md" },
  // Factory landing wraps: keep `.cursor/commands/kit-staging.md` and
  // `kit-prod.md` on disk. They are not consumer L0 (surface diet).
  {
    source: ".cursor/commands/plan-external-review.md",
    target: ".cursor/commands/plan-external-review.md",
  },
  {
    source: ".cursor/commands/plan-review-triage.md",
    target: ".cursor/commands/plan-review-triage.md",
  },
  {
    source: ".cursor/commands/field-report-resolve.md",
    target: ".cursor/commands/field-report-resolve.md",
  },
  {
    source: ".cursor/commands/dogfood.md",
    target: ".cursor/commands/dogfood.md",
  },
  // Factory-only: `.cursor/commands/public-issue-triage.md` and
  // `.cursor/commands/public-inbound-radar.md` are intentionally omitted from
  // L0 (and excluded from public-sync). See ADRs
  // 2026-08-05_factory-only-public-issue-triage-command.md and
  // 2026-09-24_public-inbound-radar.md.
  {
    source: ".cursor/commands/cursor-update-awareness.md",
    target: ".cursor/commands/cursor-update-awareness.md",
  },
  {
    source: ".cursor/commands/qa.md",
    target: ".cursor/commands/qa.md",
  },
  {
    source: ".cursor/commands/update.md",
    target: ".cursor/commands/update.md",
  },
  // Context (templates + example config; private config.json is not L0)
  {
    source: ".cursor/context/templates/plan-external-review-prompt.md",
    target: ".cursor/context/templates/plan-external-review-prompt.md",
  },
  {
    source: ".cursor/context/templates/plan.md",
    target: ".cursor/context/templates/plan.md",
  },
  {
    source: ".cursor/context/templates/context-pack.md",
    target: ".cursor/context/templates/context-pack.md",
  },
  {
    source: ".cursor/context/templates/task-brief.md",
    target: ".cursor/context/templates/task-brief.md",
  },
  {
    source: ".cursor/context/templates/handoff.md",
    target: ".cursor/context/templates/handoff.md",
  },
  {
    source: ".cursor/context/templates/adr.md",
    target: ".cursor/context/templates/adr.md",
  },
  {
    source: ".cursor/context/templates/plan-monitor.md",
    target: ".cursor/context/templates/plan-monitor.md",
  },
  {
    source: ".cursor/context/config.example.json",
    target: ".cursor/context/config.example.json",
  },
  // Scripts (canonical launchers; consumers never receive repo-root scripts/)
  {
    source: ".cursor/scripts/plan-external-review.sh",
    target: ".cursor/scripts/plan-external-review.sh",
  },
  {
    source: ".cursor/scripts/field-report-cadence-bump.sh",
    target: ".cursor/scripts/field-report-cadence-bump.sh",
  },
  {
    source: ".cursor/scripts/run-plan-all-consolidate.sh",
    target: ".cursor/scripts/run-plan-all-consolidate.sh",
  },
  // Secrets gate (structural)
  {
    source: ".cursor/hooks/pre-commit/check-secrets.sh",
    target: ".cursor/hooks/pre-commit/check-secrets.sh",
  },
  // Native Cursor agent hooks (thin adapters -> agent-kit CLI)
  {
    source: ".cursor/hooks.json",
    target: ".cursor/hooks.json",
  },
  {
    source: ".cursor/hooks/agent/resolve-agent-kit.sh",
    target: ".cursor/hooks/agent/resolve-agent-kit.sh",
  },
  {
    source: ".cursor/hooks/agent/session-start.sh",
    target: ".cursor/hooks/agent/session-start.sh",
  },
  {
    source: ".cursor/hooks/agent/pre-compact.sh",
    target: ".cursor/hooks/agent/pre-compact.sh",
  },
  {
    source: ".cursor/hooks/agent/guard-shell.sh",
    target: ".cursor/hooks/agent/guard-shell.sh",
  },
  {
    source: ".cursor/hooks/agent/after-edit-schema.sh",
    target: ".cursor/hooks/agent/after-edit-schema.sh",
  },
  {
    source: ".cursor/hooks/agent/secrets-prompt.sh",
    target: ".cursor/hooks/agent/secrets-prompt.sh",
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
