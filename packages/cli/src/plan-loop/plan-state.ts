import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  HANDOFF_REL,
  extractHandoffNamedPlans,
  namedPlanCandidatePaths,
  parsePlanFrontmatter,
} from "../plan-index/plan-index.js";
import { fileExists } from "../utils/fs.js";

/**
 * Count pending/in_progress to-dos in plan frontmatter.
 * Skips the continuous dogfood id (matches scripts/plan-loop.sh awk).
 */
export function countPendingTodos(raw: string): number {
  return parsePlanFrontmatter(raw).todos.filter(
    (t) => (t.status === "pending" || t.status === "in_progress") && t.id !== "dogfood-poc",
  ).length;
}

/** Active plan = first *.plan.md at plansDir maxdepth 1 (sorted by name). */
export async function findActivePlanFile(plansDir: string): Promise<string | null> {
  if (!(await fileExists(plansDir))) return null;
  const files = (await readdir(plansDir)).filter((f) => f.endsWith(".plan.md")).sort();
  return files[0] ? path.join(plansDir, files[0]) : null;
}

export async function readPlan(planPath: string): Promise<string> {
  return readFile(planPath, "utf8");
}

const QUEUE_CURSOR_RE = /^- \*\*Queue cursor:\*\*\s*(.+)$/m;
const QUEUE_STATUS_RE = /^- \*\*Queue status:\*\*\s*(.+)$/m;
const QUEUE_DONE_STATUSES = new Set(["exhausted", "completed", "done"]);

export interface RunQueueState {
  queue: string[];
  /** Index into `queue` from the cursor number or its `current:` name; null when neither fits. */
  cursor: number | null;
  /** Plan named by the cursor (`queue[cursor]`, else the raw `current:` basename). */
  current: string | null;
  status: string | null;
  finished: boolean;
}

/** Read-only projection of the HANDOFF Run queue / Queue cursor / Queue status fields. */
export function readRunQueueState(handoff: string): RunQueueState {
  const queue = extractHandoffNamedPlans(handoff).runQueue;
  let cursorIndex: number | null = null;
  let cursorPlan: string | null = null;
  const cursorRaw = QUEUE_CURSOR_RE.exec(handoff)?.[1]?.trim() ?? "";
  const indexMatch = /^(\d+)\b/.exec(cursorRaw);
  if (indexMatch?.[1]) cursorIndex = Number(indexMatch[1]);
  const currentMatch = /current:\s*`?([^`()]+?)`?\s*\)/i.exec(cursorRaw);
  if (currentMatch?.[1]) {
    const base = currentMatch[1].trim().split("/").pop() ?? "";
    if (/\.plan\.md$/i.test(base)) cursorPlan = base;
  }
  const status = QUEUE_STATUS_RE.exec(handoff)?.[1]?.trim().split(/\s+/)[0]?.replace(/[`*]/g, "");
  const queueStatus = status ? status : null;
  const finished = queueStatus !== null && QUEUE_DONE_STATUSES.has(queueStatus.toLowerCase());
  let cursor: number | null = null;
  if (cursorIndex !== null && cursorIndex >= 0 && cursorIndex < queue.length) {
    cursor = cursorIndex;
  } else if (cursorPlan && queue.includes(cursorPlan)) {
    cursor = queue.indexOf(cursorPlan);
  }
  const current = cursor !== null ? (queue[cursor] ?? null) : cursorPlan;
  return { queue, cursor, current, status: queueStatus, finished };
}

export interface PlanStateIo {
  readFile: (file: string) => Promise<string | null>;
  findActivePlan: (plansDir: string) => Promise<string | null>;
}

function defaultPlanStateIo(): PlanStateIo {
  return {
    readFile: async (file) => {
      try {
        return await readFile(file, "utf8");
      } catch {
        return null;
      }
    },
    findActivePlan: findActivePlanFile,
  };
}

/**
 * Active plan path from already-read HANDOFF text: the unfinished run queue's
 * current plan, else the HANDOFF `Plan:` field (plans/ then plans/archive/).
 * The alphabetical pick is a fallback only when HANDOFF names no plan.
 */
export async function resolveActivePlanFromHandoff(
  root: string,
  handoff: string,
  io: PlanStateIo = defaultPlanStateIo(),
): Promise<string | null> {
  const queue = readRunQueueState(handoff);
  const base =
    (queue.queue.length > 0 && !queue.finished ? queue.current : null) ??
    extractHandoffNamedPlans(handoff).active;
  if (!base) return io.findActivePlan(path.join(root, ".cursor", "plans"));
  for (const candidate of namedPlanCandidatePaths(root, base)) {
    if ((await io.readFile(candidate)) !== null) return candidate;
  }
  return null;
}

/** Reads `.cursor/HANDOFF.md`, then {@link resolveActivePlanFromHandoff}. */
export async function resolveActivePlanPath(
  root: string,
  io: PlanStateIo = defaultPlanStateIo(),
): Promise<string | null> {
  const handoff = (await io.readFile(path.join(root, HANDOFF_REL))) ?? "";
  return resolveActivePlanFromHandoff(root, handoff, io);
}
