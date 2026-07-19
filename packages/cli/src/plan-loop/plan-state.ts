import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../utils/fs.js";

/**
 * Count pending/in_progress to-dos in plan frontmatter.
 * Skips continuous dogfood ids (matches scripts/plan-loop.sh awk).
 */
export function countPendingTodos(raw: string): number {
  const lines = raw.split(/\r?\n/);
  let inFront = 0;
  let cont = false;
  let n = 0;

  for (const line of lines) {
    if (line === "---") {
      inFront += 1;
      continue;
    }
    if (inFront !== 1) continue;

    const idMatch = line.match(/^- id:\s*(\S+)/);
    if (idMatch?.[1]) {
      cont = idMatch[1] === "dogfood-poc";
    }
    if (/content:.*[Cc]ont[ií]nuo/.test(line)) {
      cont = true;
    }
    if (/status:\s*(pending|in_progress)\b/.test(line) && !cont) {
      n += 1;
    }
  }
  return n;
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
