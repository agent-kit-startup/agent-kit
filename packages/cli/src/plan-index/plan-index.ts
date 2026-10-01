import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../utils/fs.js";
import { HANDOFF_REL } from "../utils/kit-paths.js";

/** Generated artifact; same gitignore class as other `.cursor/context/*.json` locals. */
export const PLAN_INDEX_REL = ".cursor/context/plan-index.json";

/** Banned as a scan glob. Named single-file reads of a known basename remain OK. */
export const FORBIDDEN_PLANS_SCAN_GLOB = ".cursor/plans/*.plan.md";

export { HANDOFF_REL };

const NONE = /^(none|n\/a|empty|nil)$/i;
const OPEN_STATUSES = new Set(["pending", "in_progress"]);
const DONE_STATUSES = new Set(["completed", "cancelled"]);

export type PlanIndexRole = "active" | "backlog" | "parked" | "pending";

export interface HandoffNamedPlans {
  active: string | null;
  backlog: string[];
  parked: string[];
  runQueue: string[];
}

export interface PlanIndexEntry {
  file: string;
  role: PlanIndexRole;
  name?: string;
  openTodos: boolean;
  pendingTodoIds: string[];
  /** Present, has to-dos, and every to-do is completed or cancelled. */
  exhausted: boolean;
  missing?: boolean;
}

export interface PlanIndex {
  generatedAt: string;
  source: "handoff-named";
  plans: PlanIndexEntry[];
}

export interface PlanIndexIo {
  /** Read one file. Return null when missing. Must not list directories. */
  readFile(absPath: string): Promise<string | null>;
  writeFile?(absPath: string, body: string): Promise<void>;
}

export function defaultPlanIndexIo(): PlanIndexIo {
  return {
    async readFile(absPath) {
      try {
        return await readFile(absPath, "utf8");
      } catch {
        return null;
      }
    },
    async writeFile(absPath, body) {
      await ensureDir(path.dirname(absPath));
      await writeFile(absPath, body, "utf8");
    },
  };
}

export function extractHandoffNamedPlans(handoffText: string): HandoffNamedPlans {
  return {
    active: extractActivePlan(handoffText),
    backlog: extractPlanBasenames(
      extractFieldBlock(handoffText, "Backlog plans") ?? extractFieldBlock(handoffText, "Backlog"),
    ),
    parked: extractPlanBasenames(extractFieldBlock(handoffText, "Parked plans")),
    runQueue: extractPlanBasenames(extractFieldBlock(handoffText, "Run queue")),
  };
}

/** Unique HANDOFF-named basenames. Order: active, backlog, parked, run queue. */
export function collectNamedPlanBasenames(named: HandoffNamedPlans): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of [named.active, ...named.backlog, ...named.parked, ...named.runQueue]) {
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

export function namedPlanCandidatePaths(root: string, basename: string): string[] {
  const safe = path.basename(basename);
  if (!/^[A-Za-z0-9._-]+\.plan\.md$/i.test(safe)) return [];
  return [
    path.join(root, ".cursor", "plans", safe),
    path.join(root, ".cursor", "plans", "archive", safe),
  ];
}

export function classifyPlanRole(
  file: string,
  named: HandoffNamedPlans,
  openTodos: boolean,
): PlanIndexRole | null {
  if (named.active === file) return "active";
  if (named.backlog.includes(file)) return "backlog";
  if (named.parked.includes(file)) return "parked";
  if (openTodos) return "pending";
  return null;
}

export interface PlanFrontmatterTodo {
  id: string;
  status: string;
  content?: string;
}

export function parsePlanFrontmatter(raw: string): {
  name?: string;
  todos: PlanFrontmatterTodo[];
} {
  const match = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return { todos: [] };
  const block = match[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const todos: PlanFrontmatterTodo[] = [];
  let currentId: string | undefined;
  let currentContent: string | undefined;
  for (const line of block.split("\n")) {
    const idMatch = line.match(/^\s*- id:\s*(\S+)/);
    if (idMatch?.[1]) {
      currentId = idMatch[1].replace(/^["']|["']$/g, "");
      currentContent = undefined;
      continue;
    }
    const contentMatch = line.match(/^\s*content:\s*(.+)$/);
    if (contentMatch?.[1] && currentId) {
      currentContent = contentMatch[1].trim();
      continue;
    }
    const statusMatch = line.match(/^\s*status:\s*(\S+)/);
    if (statusMatch?.[1] && currentId) {
      const todo: PlanFrontmatterTodo = { id: currentId, status: statusMatch[1] };
      if (currentContent !== undefined) todo.content = currentContent;
      todos.push(todo);
      currentId = undefined;
      currentContent = undefined;
    }
  }
  return { name, todos };
}

export async function buildPlanIndex(
  root: string,
  io: PlanIndexIo = defaultPlanIndexIo(),
  now: () => Date = () => new Date(),
): Promise<PlanIndex> {
  const handoffPath = path.join(root, HANDOFF_REL);
  const handoffText = (await io.readFile(handoffPath)) ?? "";
  const named = extractHandoffNamedPlans(handoffText);
  const plans: PlanIndexEntry[] = [];

  for (const file of collectNamedPlanBasenames(named)) {
    const text = await readNamedPlanFile(root, file, io);
    const fm = text ? parsePlanFrontmatter(text) : { todos: [] };
    const pendingTodoIds = fm.todos.filter((t) => OPEN_STATUSES.has(t.status)).map((t) => t.id);
    const openTodos = pendingTodoIds.length > 0;
    const role = classifyPlanRole(file, named, openTodos);
    if (!role) continue;
    const exhausted =
      text !== null && fm.todos.length > 0 && fm.todos.every((t) => DONE_STATUSES.has(t.status));
    const entry: PlanIndexEntry = {
      file,
      role,
      openTodos,
      pendingTodoIds,
      exhausted,
    };
    if (fm.name) entry.name = fm.name;
    if (!text) entry.missing = true;
    plans.push(entry);
  }

  return {
    generatedAt: now().toISOString(),
    source: "handoff-named",
    plans,
  };
}

export async function writePlanIndex(
  root: string,
  io: PlanIndexIo = defaultPlanIndexIo(),
  now: () => Date = () => new Date(),
): Promise<PlanIndex> {
  const index = await buildPlanIndex(root, io, now);
  const dest = path.join(root, PLAN_INDEX_REL);
  const write = io.writeFile ?? defaultPlanIndexIo().writeFile;
  if (write) {
    await write(dest, `${JSON.stringify(index, null, 2)}\n`);
  }
  return index;
}

/** Exhausted entries collapse into one trailing `- exhausted (retire): ...` line. */
export function formatPlanIndexLines(index: PlanIndex): string[] {
  const lines = index.plans
    .filter((p) => !p.exhausted)
    .map((p) => {
      const open = p.openTodos ? ` (${p.pendingTodoIds.length} open)` : "";
      return `- ${p.role}: \`${p.file}\`${open}`;
    });
  const exhausted = index.plans.filter((p) => p.exhausted).map((p) => `\`${p.file}\``);
  if (exhausted.length > 0) lines.push(`- exhausted (retire): ${exhausted.join(", ")}`);
  return lines;
}

export function formatPlanIndexSection(index: PlanIndex): string | null {
  if (index.plans.length === 0) return null;
  return `## Pending plans (index)\n\n${formatPlanIndexLines(index).join("\n")}`;
}

async function readNamedPlanFile(
  root: string,
  basename: string,
  io: PlanIndexIo,
): Promise<string | null> {
  for (const candidate of namedPlanCandidatePaths(root, basename)) {
    const text = await io.readFile(candidate);
    if (text !== null) return text;
  }
  return null;
}

function extractActivePlan(content: string): string | null {
  const match = content.match(/^- \*\*Plan:\*\*\s*(.+)$/m);
  if (!match?.[1]) return null;
  let raw = match[1].trim();
  const tick = raw.match(/^`([^`]+)`/);
  if (tick?.[1]) raw = tick[1].trim();
  if (!raw || NONE.test(raw)) return null;
  return raw.match(/([A-Za-z0-9._-]+\.plan\.md)/i)?.[1] ?? null;
}

export function extractFieldBlock(content: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.*)$`, "m");
  const match = content.match(re);
  if (!match) return null;
  const chunks: string[] = [];
  const same = (match[1] ?? "").trim();
  if (same) chunks.push(same);
  const after = content.slice((match.index ?? 0) + match[0].length);
  for (const line of after.split("\n")) {
    if (/^- \*\*[^*:\n]+:\*\*/.test(line)) break;
    if (!line.trim()) continue;
    if (/^\s+\S/.test(line)) {
      chunks.push(line.trim());
      continue;
    }
    break;
  }
  return chunks.join("\n").trim() || null;
}

function extractPlanBasenames(raw: string | null): string[] {
  if (!raw) return [];
  const text = raw
    .trim()
    .replace(/^\[/, "")
    .replace(/\]\s*$/, "");
  const ids: string[] = [];
  const seen = new Set<string>();
  const ticks = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const parts = ticks.length > 0 ? ticks : text.split(/[,;\n]/);
  for (const part of parts) {
    const cleaned = String(part)
      .replace(/\(.*?\)/g, "")
      .trim()
      .replace(/^-\s*/, "")
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .replace(/^plans\//, "");
    if (!cleaned || NONE.test(cleaned)) continue;
    const base = cleaned.split("/").pop();
    if (!base || !/\.plan\.md$/i.test(base) || seen.has(base)) continue;
    seen.add(base);
    ids.push(base);
  }
  return ids;
}
