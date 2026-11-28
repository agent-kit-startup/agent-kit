/**
 * Bounded discovery of kit installs (`.cursor/agent-kit.json`) under a few
 * roots. Read-only; never follows symlinks.
 *
 * Bounds: a depth cap, a cap on directories visited, and a skip list. Hidden
 * directories are skipped (caches, `.git` internals, `.local`, `.npm`, …)
 * except the worktree homes `.worktrees/` and `.claude/worktrees/`.
 */

import type { Dirent } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { hasInstallManifest } from "./inspect.js";

export const DEFAULT_SCAN_DEPTH = 5;
export const DEFAULT_SCAN_MAX_DIRS = 20_000;

/** Directory names never descended into (besides hidden ones). */
const SKIP_DIRS = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "target",
  "out",
  "coverage",
  "__pycache__",
  "venv",
  "Library",
  "Applications",
  "snap",
  "AppData",
]);

/** Hidden directories that may hold worktrees, with the subpath to descend into. */
const HIDDEN_WORKTREE_HOMES: Record<string, string> = {
  ".worktrees": ".worktrees",
  ".claude": path.join(".claude", "worktrees"),
};

export interface ScanOptions {
  maxDepth?: number;
  maxDirs?: number;
}

export interface ScanResult {
  /** Real paths of directories holding `.cursor/agent-kit.json`, sorted. */
  found: string[];
  visited: number;
  /** True when the directory cap stopped the walk early. */
  truncated: boolean;
}

export async function scanForInstalls(
  roots: readonly string[],
  options: ScanOptions = {},
): Promise<ScanResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_SCAN_DEPTH;
  const maxDirs = options.maxDirs ?? DEFAULT_SCAN_MAX_DIRS;
  const found = new Set<string>();
  const seen = new Set<string>();
  let visited = 0;
  let truncated = false;

  // Breadth-first so a capped walk still covers the shallow levels.
  const queue: Array<{ dir: string; depth: number }> = [];
  for (const root of roots) {
    try {
      queue.push({ dir: await realpath(path.resolve(root)), depth: 0 });
    } catch {
      // Missing root: nothing to scan there.
    }
  }

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const { dir, depth } = next;
    if (seen.has(dir)) continue;
    if (visited >= maxDirs) {
      truncated = true;
      break;
    }
    seen.add(dir);
    visited += 1;

    if (await hasInstallManifest(dir)) found.add(dir);
    if (depth >= maxDepth) continue;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Dirent.isDirectory() is false for symlinks: links are never followed.
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith(".")) {
        const sub = HIDDEN_WORKTREE_HOMES[name];
        if (sub) queue.push({ dir: path.join(dir, sub), depth: depth + 1 });
        continue;
      }
      if (SKIP_DIRS.has(name)) continue;
      queue.push({ dir: path.join(dir, name), depth: depth + 1 });
    }
  }

  return { found: [...found].sort(), visited, truncated };
}
