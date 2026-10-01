import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Resolve `rel` under `root` and ensure the result stays inside `root`
 * (blocks `..` / absolute escape). Returns absolute path.
 */
export function resolveContained(root: string, rel: string): string {
  const rootAbs = path.resolve(root);
  const candidate = path.resolve(rootAbs, rel);
  if (escapesRoot(rootAbs, candidate)) {
    throw new Error(`Path escapes registry/project root: ${rel}`);
  }
  return candidate;
}

function escapesRoot(rootAbs: string, candidate: string): boolean {
  const relToRoot = path.relative(rootAbs, candidate);
  // Segment-aware: `..cache/a` is a legitimate child, only a real `..` segment escapes.
  return relToRoot === ".." || relToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relToRoot);
}

/**
 * Filesystem-level containment for an existing `abs` under `root`.
 * `resolveContained` is lexical only; this rejects a symlink leaf and, via
 * realpath, a symlinked parent directory that lands outside realpath(root).
 * Throws when `abs` is not really contained (or cannot be resolved).
 */
export async function assertRealContained(root: string, abs: string): Promise<void> {
  const stat = await lstat(abs);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to follow symlink: ${abs}`);
  }
  const [rootReal, absReal] = await Promise.all([realpath(root), realpath(abs)]);
  if (escapesRoot(rootReal, absReal)) {
    throw new Error(`Path resolves outside root via symlink: ${abs}`);
  }
}

/**
 * For a path that does not exist yet: the nearest existing ancestor must resolve
 * inside root, so `mkdir -p` + write cannot follow a symlinked parent outside it.
 */
export async function assertRealParentContained(root: string, abs: string): Promise<void> {
  let dir = path.dirname(abs);
  for (;;) {
    try {
      await lstat(dir);
      break;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const [rootReal, dirReal] = await Promise.all([realpath(root), realpath(dir)]);
  if (escapesRoot(rootReal, dirReal)) {
    throw new Error(`Parent directory resolves outside root via symlink: ${abs}`);
  }
}

/**
 * Write-target guard: true when writing `abs` cannot land outside `root` through
 * a symlink. Existing entry (a dangling symlink counts as existing) -> leaf and
 * realpath check; missing entry -> nearest existing ancestor check.
 */
export async function isRealWriteTargetContained(root: string, abs: string): Promise<boolean> {
  try {
    let exists = true;
    try {
      await lstat(abs);
    } catch {
      exists = false;
    }
    if (exists) await assertRealContained(root, abs);
    else await assertRealParentContained(root, abs);
    return true;
  } catch {
    return false;
  }
}

export function toPosixRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}
