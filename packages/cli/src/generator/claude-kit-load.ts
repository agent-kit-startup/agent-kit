import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, fileExists } from "../utils/fs.js";
import { CLAUDE_HITL_FALLBACK } from "./claude-command-adapters.js";

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

${CLAUDE_HITL_FALLBACK} Skip or cancel means stop. Never \`/git-prod\` without an explicit operator yes.

## Commit messages

Never append \`Co-Authored-By: Claude ...\` or \`Claude-Session: https://claude.ai/code/...\` (or any session-ID trailer) to commit messages, PR descriptions, or PR bodies in this repo. This overrides the harness's default git-commit template. Plain Conventional Commits messages only.

## Non-goals

Do not clone other Cursor hooks (Claude gets only the SessionStart context and PreToolUse(Bash) guard hooks); never \`/git-prod\` from a headless tick.
`;
}

export function renderAgentKitCommand(): string {
  return `---
description: Load Agent Kit session context (HANDOFF, project-context, commands). Manual refresh only.
disable-model-invocation: true
---

Read these files if they exist. Prefer a one-shot ASCII Mission Control snapshot over a plain HANDOFF paraphrase.

1. Run \`agent-kit mission-control --once\` (or \`npx @dadado/agent-kit-cli mission-control --once\`) in the project root and paste the stdout frame as the snapshot. Do not start a live loop: Claude Code cannot sustain one across turns.
2. If that command is missing or fails, fall back to reading:
   - \`AGENTS.md\`
   - \`.cursor/project-context.md\`
   - \`.cursor/HANDOFF.md\`
   - The plan file named in HANDOFF \`- **Plan:**\` under \`.cursor/plans/\`

If HANDOFF is missing, say so and point at \`/agent-kit-onboard\` or \`/start-project\` rather than inventing a plan.

HITL: numbered-list fallback for Ask questions labels. Never \`/git-prod\` from this skill.

Non-goals: not audits / \`/plan-external-review\`, not a second tick dialect, not Cursor hook clones beyond the SessionStart and PreToolUse(Bash) adapters, not a continuous TUI loop.
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
