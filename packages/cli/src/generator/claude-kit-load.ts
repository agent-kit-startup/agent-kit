import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, fileExists } from "../utils/fs.js";

export const CLAUDE_MD_REL = "CLAUDE.md";
export const AGENT_KIT_COMMAND_REL = ".claude/commands/agent-kit.md";

export interface ClaudeKitLoadArtifactResult {
  relativePath: string;
  status: "applied" | "skipped-customized";
}

export function renderClaudeMd(): string {
  return `# Agent Kit (Claude Code)

This repository uses Agent Kit / Mission Control. Before rediscovering the tree, read the shared sources of truth (paths below are pointers; do not treat this file as a second rulebook).

## Read first

1. \`AGENTS.md\` - cross-IDE contract
2. \`.cursor/project-context.md\` - verified repository facts (derived; prefer code, tests, SHAs when docs conflict)
3. \`.cursor/HANDOFF.md\` - if present: active plan, next to-do, queue fields
4. \`.cursor/commands/\` - slash catalog (Cursor). Follow the same HITL contracts here.

Mid-session refresh: \`/agent-kit\`.

## HITL

Cursor Ask questions is not available in this CLI. When a command requires a choice, list the same labels as a numbered list and wait. Skip or cancel means stop. Never \`/git-prod\` without an explicit operator yes.

## Non-goals

- Not Action A7 (Windsurf / VS Code generator parity)
- Not Claude external plan-review audits (\`/plan-external-review\`)
- Not \`--backend claude\` plan-loop ticks
- Not a copy of Cursor hooks beyond the opt-in SessionStart context adapter (\`agent-kit hook session-start --format claude\`); no \`.claude/rules/\` mirrors, no \`.claude/agents/\` generated from the registry
`;
}

export function renderAgentKitCommand(): string {
  return `---
description: Load Agent Kit session context (HANDOFF, project-context, commands). Manual refresh only.
disable-model-invocation: true
---

Read these files if they exist, then summarize the active plan, next to-do, and any Gaps. Do not scan the whole repository first.

1. \`AGENTS.md\`
2. \`.cursor/project-context.md\`
3. \`.cursor/HANDOFF.md\`
4. The plan file named in HANDOFF \`- **Plan:**\` under \`.cursor/plans/\`

If HANDOFF is missing, say so and point at \`/agent-kit-onboard\` or \`/start-project\` rather than inventing a plan.

HITL: numbered-list fallback for Ask questions labels. Never \`/git-prod\` from this skill.

Non-goals: not audits / \`/plan-external-review\`, not \`--backend claude\` ticks, not A7, not Cursor hook clones.
`;
}

async function writeUnlessExists(
  rootDir: string,
  relativePath: string,
  content: string,
): Promise<ClaudeKitLoadArtifactResult> {
  const target = path.join(rootDir, relativePath);
  if (await fileExists(target)) {
    return { relativePath, status: "skipped-customized" };
  }
  await ensureDir(path.dirname(target));
  await writeFile(target, content, "utf8");
  return { relativePath, status: "applied" };
}

/** Always emit (not detectIde). Skip each path independently when the consumer already has a file. */
export async function generateClaudeKitLoadArtifacts(
  rootDir: string,
): Promise<ClaudeKitLoadArtifactResult[]> {
  return Promise.all([
    writeUnlessExists(rootDir, CLAUDE_MD_REL, renderClaudeMd()),
    writeUnlessExists(rootDir, AGENT_KIT_COMMAND_REL, renderAgentKitCommand()),
  ]);
}
