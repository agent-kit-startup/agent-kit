import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { TRIAGE_HEADING_RE } from "./triage-heading.js";

const execFileAsync = promisify(execFile);

export { TRIAGE_HEADING_RE };

export interface MonitorEntry {
  path: string;
  relativePath: string;
  mtimeMs: number;
  hasTriageHeading: boolean;
  hasOpenGaps: boolean;
  selectionBucket: "git-fresh" | "handoff-aligned" | "untriaged-scan";
}

export interface UntriagedMonitorsResult {
  selectionOrder: string[];
  monitors: MonitorEntry[];
  cite: string;
}

const CITE =
  "agent-kit monitors --untriaged (ADR 2026-07-27_plan-review-triage-untriaged-not-mtime; never newest-mtime-wins)";

function hasOpenGaps(content: string): boolean {
  if (/###\s+Still open[^\n]*\n+(?:\s*\n)*(?:None\.|none\.|\*None\*)/i.test(content)) {
    return false;
  }
  if (
    /###\s+Still open/i.test(content) &&
    !/###\s+Still open[^\n]*\n+(?:\s*\n)*(?:None\.|none\.)/i.test(content)
  ) {
    // Still open section present with non-empty body heuristic
    const m = content.match(/###\s+Still open[^\n]*\n([\s\S]*?)(?=\n### |\n## |$)/i);
    if (m?.[1]?.trim() && !/^(none\.?|\*none\*)$/i.test(m[1].trim())) {
      return true;
    }
  }
  if (/^#{2,6}\s+.*\bResidual items?\b/im.test(content)) return true;
  return false;
}

async function listMonitorFiles(memoryDir: string): Promise<string[]> {
  try {
    const names = await readdir(memoryDir);
    return names.filter((n) => n.startsWith("plan-monitor-") && n.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

async function gitFreshMonitorNames(rootDir: string): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--", ".cursor/memory"],
      { cwd: rootDir, maxBuffer: 2 * 1024 * 1024 },
    );
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const file = line
        .slice(3)
        .trim()
        .replace(/^.* -> /, "");
      const base = path.basename(file);
      if (base.startsWith("plan-monitor-") && base.endsWith(".md")) {
        names.add(base);
      }
    }
  } catch {
    // fail soft: empty git-fresh set
  }
  return names;
}

function extractHandoffPlanSlugs(handoff: string): Set<string> {
  const slugs = new Set<string>();
  for (const m of handoff.matchAll(/`([a-z0-9][a-z0-9._-]*)\.plan\.md`/gi)) {
    if (m[1]) slugs.add(m[1].toLowerCase());
  }
  for (const m of handoff.matchAll(/plan-monitor-([a-z0-9][a-z0-9._-]*)\.md/gi)) {
    if (m[1]) slugs.add(m[1].toLowerCase());
  }
  return slugs;
}

function monitorSlugFromName(fileName: string): string {
  return fileName
    .replace(/^plan-monitor-/, "")
    .replace(/\.md$/, "")
    .toLowerCase();
}

async function loadEntry(
  rootDir: string,
  memoryDir: string,
  fileName: string,
  bucket: MonitorEntry["selectionBucket"],
): Promise<MonitorEntry | null> {
  const abs = path.join(memoryDir, fileName);
  try {
    const [content, st] = await Promise.all([readFile(abs, "utf8"), stat(abs)]);
    return {
      path: abs,
      relativePath: path.relative(rootDir, abs).split(path.sep).join("/"),
      mtimeMs: st.mtimeMs,
      hasTriageHeading: TRIAGE_HEADING_RE.test(content),
      hasOpenGaps: hasOpenGaps(content),
      selectionBucket: bucket,
    };
  } catch {
    return null;
  }
}

/**
 * Selection SoT for bare `/plan-review-triage`: git-fresh → HANDOFF-aligned → untriaged scan.
 * Stops at the first non-empty untriaged set. Mtime is only a weak tie-break within a set.
 */
export async function selectUntriagedMonitors(rootDir: string): Promise<UntriagedMonitorsResult> {
  const root = path.resolve(rootDir);
  const memoryDir = path.join(root, ".cursor", "memory");
  const allNames = await listMonitorFiles(memoryDir);
  const selectionOrder = ["git-fresh", "handoff-aligned", "untriaged-scan"] as const;

  const byName = new Map<string, { content: string; mtimeMs: number }>();
  for (const name of allNames) {
    const abs = path.join(memoryDir, name);
    try {
      const [content, st] = await Promise.all([readFile(abs, "utf8"), stat(abs)]);
      byName.set(name, { content, mtimeMs: st.mtimeMs });
    } catch {
      // skip unreadable
    }
  }

  const untriaged = (name: string): boolean => {
    const row = byName.get(name);
    return !!row && !TRIAGE_HEADING_RE.test(row.content);
  };

  const gitFresh = await gitFreshMonitorNames(root);
  const gitFreshSet = [...gitFresh].filter(untriaged).sort();

  let handoff = "";
  try {
    handoff = await readFile(path.join(root, ".cursor", "HANDOFF.md"), "utf8");
  } catch {
    handoff = "";
  }
  const handoffSlugs = extractHandoffPlanSlugs(handoff);
  const handoffAligned = allNames
    .filter((n) => untriaged(n) && handoffSlugs.has(monitorSlugFromName(n)))
    .sort();

  const scanAll = allNames.filter(untriaged);

  let chosen: { names: string[]; bucket: MonitorEntry["selectionBucket"] };
  if (gitFreshSet.length > 0) {
    chosen = { names: gitFreshSet, bucket: "git-fresh" };
  } else if (handoffAligned.length > 0) {
    chosen = { names: handoffAligned, bucket: "handoff-aligned" };
  } else {
    chosen = { names: scanAll, bucket: "untriaged-scan" };
  }

  const entries: MonitorEntry[] = [];
  for (const name of chosen.names) {
    const row = byName.get(name);
    if (!row) continue;
    entries.push({
      path: path.join(memoryDir, name),
      relativePath: path.relative(root, path.join(memoryDir, name)).split(path.sep).join("/"),
      mtimeMs: row.mtimeMs,
      hasTriageHeading: false,
      hasOpenGaps: hasOpenGaps(row.content),
      selectionBucket: chosen.bucket,
    });
  }

  // Prefer open gaps, then newer mtime as weak tie-break only.
  entries.sort((a, b) => {
    if (a.hasOpenGaps !== b.hasOpenGaps) return a.hasOpenGaps ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });

  return {
    selectionOrder: [...selectionOrder],
    monitors: entries,
    cite: CITE,
  };
}

/** Test helper: load one monitor entry. */
export async function readMonitorEntry(
  rootDir: string,
  fileName: string,
  bucket: MonitorEntry["selectionBucket"] = "untriaged-scan",
): Promise<MonitorEntry | null> {
  return loadEntry(
    rootDir,
    path.join(path.resolve(rootDir), ".cursor", "memory"),
    fileName,
    bucket,
  );
}
