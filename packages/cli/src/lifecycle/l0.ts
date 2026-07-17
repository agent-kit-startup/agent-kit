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
  // Commands
  {
    source: ".cursor/commands/iniciar-projeto.md",
    target: ".cursor/commands/iniciar-projeto.md",
  },
  {
    source: ".cursor/commands/continuar-plano.md",
    target: ".cursor/commands/continuar-plano.md",
  },
  {
    source: ".cursor/commands/executar-plano-loop.md",
    target: ".cursor/commands/executar-plano-loop.md",
  },
  {
    source: ".cursor/commands/executar-plano-orquestrado.md",
    target: ".cursor/commands/executar-plano-orquestrado.md",
  },
  { source: ".cursor/commands/handoff.md", target: ".cursor/commands/handoff.md" },
  { source: ".cursor/commands/resumo.md", target: ".cursor/commands/resumo.md" },
  {
    source: ".cursor/commands/git-staging.md",
    target: ".cursor/commands/git-staging.md",
  },
  {
    source: ".cursor/commands/git-homolog.md",
    target: ".cursor/commands/git-homolog.md",
  },
  { source: ".cursor/commands/git-prod.md", target: ".cursor/commands/git-prod.md" },
  // Secrets gate (structural)
  {
    source: ".cursor/hooks/pre-commit/check-secrets.sh",
    target: ".cursor/hooks/pre-commit/check-secrets.sh",
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
