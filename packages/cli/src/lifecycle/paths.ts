import path from "node:path";

/**
 * Resolve `rel` under `root` and ensure the result stays inside `root`
 * (blocks `..` / absolute escape). Returns absolute path.
 */
export function resolveContained(root: string, rel: string): string {
  const rootAbs = path.resolve(root);
  const candidate = path.resolve(rootAbs, rel);
  const relToRoot = path.relative(rootAbs, candidate);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error(`Path escapes registry/project root: ${rel}`);
  }
  return candidate;
}

export function toPosixRel(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}
