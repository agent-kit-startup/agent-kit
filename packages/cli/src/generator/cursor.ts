import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectProfile } from "../types.js";
import { ensureDir } from "../utils/fs.js";
import {
  ciLabel,
  gitCliTool,
  gitProviderLabel,
  pmRoutineLine,
  pmToolsList,
  prTerminology,
} from "./platform.js";

function buildGitWorkflowRule(profile: ProjectProfile): string {
  const prTerm = prTerminology(profile);
  const cli = gitCliTool(profile);
  const provider = gitProviderLabel(profile);
  const pm = pmToolsList(profile);

  const lines = [
    "# Git Workflow",
    `- Platform: ${provider} | CLI: \`${cli}\``,
    "- Use Conventional Commits (feat:, fix:, docs:, refactor:, chore:, perf:, test:).",
    "- For risky changes, prefer /worktree (isolated git worktree).",
    "- For comparing approaches, use /best-of-n.",
  ];

  if (profile.git.workflow === "homolog-prod") {
    lines.push(
      "- Flow: development → staging → production.",
      `- Create ${prTerm} targeting the staging branch; merge to main only via promotion.`,
      "- NEVER commit directly to main.",
    );
  } else if (profile.git.workflow === "feature-pr") {
    lines.push(
      `- Flow: feature branch → ${prTerm} → main.`,
      `- Always create a ${prTerm} for review before merging.`,
    );
  } else if (profile.git.workflow === "gitflow") {
    lines.push(
      "- Flow: feature → develop → release → main.",
      `- Create ${prTerm} targeting develop for features, main for releases.`,
    );
  }

  if (pm) {
    lines.push(`- After merge: update task status in ${pm} if integration is available.`);
  }

  return `${lines.join("\n")}\n`;
}

function buildHandoffRule(profile: ProjectProfile): string {
  const pm = pmRoutineLine(profile);
  const routines = ["- Suggest routines: git commit/push, review CHANGELOG."];
  if (pm) routines.push(`${pm}.`);

  return `# Handoff — State in File
- After completing each task: save .cursor/HANDOFF.md with progress and next steps.
- Update to-dos in the plan (.cursor/plans/) when completing or starting a task.
- One HANDOFF per project — source of truth for continuity.
${routines.join("\n")}
- To resume: /continue-plan in a new conversation.
- Native features (summaries, /resume, transcripts, Agents Window) complement — not replace.
- Context at ~60%: save handoff and suggest new conversation.
`;
}

function cursorRulesByPlan(profile: ProjectProfile) {
  if (profile.ide.plan === "cursor-free") {
    return [
      {
        filename: "01-core.mdc",
        content: `# Core Rule
- Respond directly and concisely.
- Focus on small changes and local validation.
- Size each task for ~50% of context window.
`,
      },
      {
        filename: "02-handoff.mdc",
        content: buildHandoffRule(profile),
      },
    ];
  }

  return [
    {
      filename: "01-core.mdc",
      content: `# Core Rule
- Execute tasks end-to-end whenever possible.
- Prioritize security, tests, and architectural consistency.
- Size each task for ~50% of context window.
`,
    },
    {
      filename: "02-git-workflow.mdc",
      content: buildGitWorkflowRule(profile),
    },
    {
      filename: "03-handoff.mdc",
      content: buildHandoffRule(profile),
    },
    {
      filename: "04-ide-guide.mdc",
      content: `# Cursor Guide
- Use Agents Window for parallelism — each agent reads HANDOFF before acting.
- Use Await for long-running processes.
- Transcripts and @mentions for cross-reference.
- /worktree for risky changes.
- /best-of-n to compare approaches.
`,
    },
  ];
}

export async function generateCursorArtifacts(profile: ProjectProfile): Promise<void> {
  const rulesDir = path.join(profile.rootDir, ".cursor", "rules");
  const skillsDir = path.join(profile.rootDir, ".cursor", "skills", "core");
  const agentsDir = path.join(profile.rootDir, ".cursor", "agents");
  const commandsDir = path.join(profile.rootDir, ".cursor", "commands");

  await Promise.all([
    ensureDir(rulesDir),
    ensureDir(skillsDir),
    ensureDir(agentsDir),
    ensureDir(commandsDir),
  ]);

  const rules = cursorRulesByPlan(profile);
  await Promise.all(
    rules.map((rule) => writeFile(path.join(rulesDir, rule.filename), rule.content, "utf8")),
  );

  const includeAgents = profile.ide.plan !== "cursor-free";
  if (includeAgents) {
    await writeFile(
      path.join(agentsDir, "security-reviewer.md"),
      "# Security Reviewer\n\nFocus on auth, PII, secrets, injection, and logging.\n",
      "utf8",
    );
  }

  const ci = ciLabel(profile);
  const provider = gitProviderLabel(profile);
  const statusLines = [
    "# /agent-kit-status",
    "",
    "Show current profile and active components.",
    "",
    "## DevOps Flow",
    `- Git: ${provider} (${profile.git.workflow})`,
  ];
  if (ci) statusLines.push(`- CI/CD: ${ci}`);
  const pm = pmToolsList(profile);
  if (pm) statusLines.push(`- Project management: ${pm}`);
  statusLines.push("");

  await writeFile(
    path.join(commandsDir, "agent-kit-status.md"),
    `${statusLines.join("\n")}\n`,
    "utf8",
  );
}
