import { spawn } from "node:child_process";
import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineCommand } from "citty";
import { pruneHandoffText } from "../invariants/handoff-prune.js";
import type { ProjectProfile } from "../types.js";
import { PM_TOOL_LABELS } from "../types.js";
import { ensureDir, fileExists, readJson } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

/** Default number of recent narrative chunks `--prune` keeps in place. */
export const HANDOFF_PRUNE_DEFAULT_KEEP = 5;

function pruneArchiveTimestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/**
 * Prune `.cursor/HANDOFF.md` in place: keep the `keep` most recent narrative
 * chunks, archive the rest to `.cursor/context/archive/handoff-<stamp>.md`.
 * Never auto-triggered by a plain `agent-kit handoff` run -- explicit flag
 * only, so an operator's narrative is never silently mutated.
 */
export async function runPrune(cwd: string, keep: number): Promise<void> {
  const handoffPath = path.join(cwd, ".cursor", "HANDOFF.md");
  if (!(await fileExists(handoffPath))) {
    logger.warn("No .cursor/HANDOFF.md to prune.");
    return;
  }
  const original = await readFile(handoffPath, "utf8");
  const result = pruneHandoffText(original, keep);
  if (!result.ok) {
    logger.warn(`Refusing to prune: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  if (!result.archived || result.archived.length === 0) {
    logger.info(
      `HANDOFF.md already at or under ${keep} narrative ${keep === 1 ? "entry" : "entries"}; nothing to prune.`,
    );
    return;
  }

  const archiveDir = path.join(cwd, ".cursor", "context", "archive");
  await ensureDir(archiveDir);
  const archivePath = path.join(archiveDir, `handoff-${pruneArchiveTimestamp()}.md`);
  const header = [
    `<!-- Pruned from .cursor/HANDOFF.md at ${new Date().toISOString()} -->`,
    `<!-- ${result.archived.length} narrative ${result.archived.length === 1 ? "entry" : "entries"} archived, keep=${keep} -->`,
    "",
  ].join("\n");
  const body = `${result.archived.join("\n\n")}\n`;
  if (await fileExists(archivePath)) {
    await appendFile(archivePath, `\n${header}${body}`, "utf8");
  } else {
    await writeFile(archivePath, `${header}${body}`, "utf8");
  }

  await writeFile(handoffPath, result.text ?? original, "utf8");
  logger.success(
    `HANDOFF.md pruned: kept ${result.keptCount} narrative ${result.keptCount === 1 ? "entry" : "entries"}, archived ${result.archived.length} to ${path.relative(cwd, archivePath)}.`,
  );
}

interface PlanFrontmatter {
  name?: string;
  todos?: { id: string; content: string; status: string }[];
}

function parsePlanFrontmatter(raw: string): PlanFrontmatter | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return null;
  const block = match[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const todos: PlanFrontmatter["todos"] = [];
  const todoBlocks = block.matchAll(/- id:\s*(\S+)\s*\n\s*content:\s*(.+)\n\s*status:\s*(\S+)/g);
  for (const m of todoBlocks) {
    if (m[1] && m[2] && m[3]) {
      todos.push({ id: m[1], content: m[2].replace(/^["']|["']$/g, ""), status: m[3] });
    }
  }
  return { name, todos };
}

async function findActivePlan(plansDir: string): Promise<{ file: string; raw: string } | null> {
  if (!(await fileExists(plansDir))) return null;
  const files = (await readdir(plansDir))
    .filter((f) => f.endsWith(".plan.md"))
    .sort()
    .reverse();
  for (const file of files) {
    const raw = await readFile(path.join(plansDir, file), "utf8");
    const fm = parsePlanFrontmatter(raw);
    if (fm?.todos?.some((t) => t.status !== "completed" && t.status !== "cancelled")) {
      return { file, raw };
    }
  }
  return files[0]
    ? { file: files[0], raw: await readFile(path.join(plansDir, files[0]), "utf8") }
    : null;
}

function now(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 16);
}

async function loadProfile(rootDir: string): Promise<ProjectProfile | null> {
  const configPath = path.join(rootDir, ".cursor", "agent-kit.config.json");
  try {
    return await readJson<ProjectProfile>(configPath);
  } catch {
    return null;
  }
}

export function buildRoutines(profile: ProjectProfile | null): string[] {
  const lines: string[] = [];
  const workflow = profile?.git.workflow;
  if (workflow === "homolog-prod") {
    lines.push("- [ ] `git staging` - move changes to staging");
    lines.push("- [ ] `git prod` - promote to production (after approval)");
  } else {
    lines.push("- [ ] Commit, push and open PR/MR");
  }

  const pmTools = profile?.services.projectManagement;
  if (pmTools && pmTools.length > 0) {
    const labels = pmTools.map((t) => PM_TOOL_LABELS[t]).join(", ");
    lines.push(`- [ ] Update tasks in ${labels} (if applicable)`);
  }

  lines.push("- [ ] Review CHANGELOG");
  return lines;
}

function closingInstruction(profile: ProjectProfile | null): string {
  const pmTools = profile?.services.projectManagement;
  if (pmTools && pmTools.length > 0) {
    const labels = pmTools.map((t) => PM_TOOL_LABELS[t]).join(", ");
    return `All todos completed. Check git staging/prod and update ${labels} if applicable.`;
  }
  return "All todos completed. Check commit/push and PR/MR.";
}

function buildHandoff(
  planFile: string,
  fm: PlanFrontmatter,
  profile: ProjectProfile | null,
): string {
  const completed = fm.todos?.filter((t) => t.status === "completed") ?? [];
  const pending = fm.todos?.filter((t) => t.status === "pending") ?? [];
  const inProgress = fm.todos?.filter((t) => t.status === "in_progress") ?? [];
  const nextTodo = inProgress[0] ?? pending[0];

  const completedPhase = completed.length;
  const totalPhases = fm.todos?.length ?? 0;
  const routines = buildRoutines(profile);

  return [
    `# Handoff - ${fm.name ?? planFile}`,
    "",
    `- **Plan:** ${planFile}`,
    `- **Last updated:** ${now()}`,
    `- **Progress:** ${completedPhase}/${totalPhases} todos completed`,
    "",
    "## Completed",
    ...(completed.length > 0
      ? completed.map((t) => `- [x] \`${t.id}\`: ${t.content}`)
      : ["- (none)"]),
    "",
    "## In progress",
    ...(inProgress.length > 0
      ? inProgress.map((t) => `- [ ] \`${t.id}\`: ${t.content}`)
      : ["- (none)"]),
    "",
    "## Pending",
    ...(pending.length > 0 ? pending.map((t) => `- [ ] \`${t.id}\`: ${t.content}`) : ["- (none)"]),
    "",
    "## Instruction for Next Agent",
    "",
    nextTodo
      ? `Continue from todo \`${nextTodo.id}\`: ${nextTodo.content}.`
      : closingInstruction(profile),
    "",
    "## Suggested routines",
    "",
    ...routines,
    "",
    "---",
    "*Generated by `agent-kit handoff`. To resume: open new conversation and say `/continue-plan`.*",
    "",
  ].join("\n");
}

function printV3Guidance(): void {
  logger.info("No plan in .cursor/plans/ and no ./cursor-handoff in this directory.");
  logger.info(
    "Create a plan with todos or update .cursor/HANDOFF.md manually (/handoff command in Cursor).",
  );
  logger.info("Resume in IDE: /resume, summaries and transcripts.");
}

function runCursorHandoff(scriptPath: string, cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [scriptPath, "handoff"], {
      cwd,
      stdio: "inherit",
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export const handoffCommand = defineCommand({
  meta: {
    name: "handoff",
    description: "Write .cursor/HANDOFF.md from the active plan (or cursor-handoff fallback).",
  },
  args: {
    cwd: {
      type: "string",
      description: "Project root directory",
      default: process.cwd(),
    },
    prune: {
      type: "boolean",
      description:
        "Prune .cursor/HANDOFF.md in place instead of regenerating it: keep the most recent narrative entries, archive the rest to .cursor/context/archive/. Never auto-triggered.",
      default: false,
    },
    keep: {
      type: "string",
      description: `With --prune, how many recent narrative entries to keep in place (default ${HANDOFF_PRUNE_DEFAULT_KEEP}).`,
    },
  },
  async run({ args }) {
    if (args.prune) {
      const keepArg = typeof args.keep === "string" ? Number.parseInt(args.keep, 10) : undefined;
      const keep =
        keepArg !== undefined && Number.isFinite(keepArg) && keepArg >= 0
          ? keepArg
          : HANDOFF_PRUNE_DEFAULT_KEEP;
      await runPrune(args.cwd, keep);
      return;
    }
    const profile = await loadProfile(args.cwd);
    const plansDir = path.join(args.cwd, ".cursor", "plans");
    const handoffPath = path.join(args.cwd, ".cursor", "HANDOFF.md");

    const plan = await findActivePlan(plansDir);
    if (plan) {
      const fm = parsePlanFrontmatter(plan.raw);
      if (fm) {
        await ensureDir(path.join(args.cwd, ".cursor"));
        const content = buildHandoff(plan.file, fm, profile);
        await writeFile(handoffPath, content, "utf8");

        logger.success("HANDOFF.md updated: .cursor/HANDOFF.md");
        logger.info(
          `Plan: ${plan.file} (${fm.todos?.filter((t) => t.status === "completed").length}/${fm.todos?.length} completed)`,
        );
        logger.info("");
        logger.info("Suggested next steps:");
        let n = 1;
        for (const line of buildRoutines(profile)) {
          logger.info(`  ${n}. ${line.replace(/^- \[ \] /, "")}`);
          n += 1;
        }
        logger.info("");
        logger.info("To resume: open new conversation and say /continue-plan");
        return;
      }
      logger.warn(`Plan ${plan.file} without valid frontmatter; trying legacy flow.`);
    }

    const scriptPath = path.join(args.cwd, "cursor-handoff");
    if (!(await fileExists(scriptPath))) {
      printV3Guidance();
      return;
    }

    if (process.platform === "win32") {
      logger.warn(
        "cursor-handoff is a shell script. On Windows, run in Git Bash or WSL: sh cursor-handoff handoff",
      );
      printV3Guidance();
      return;
    }

    try {
      const code = await runCursorHandoff(scriptPath, args.cwd);
      if (code !== 0) {
        process.exitCode = code;
      }
    } catch (err) {
      logger.warn(`Failed to execute cursor-handoff: ${String(err)}`);
      printV3Guidance();
    }
  },
});
