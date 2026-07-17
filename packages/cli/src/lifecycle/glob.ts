/**
 * Minimal glob matcher for project-relative paths (/, no leading slash).
 * Supports `*` (one segment chunk) and `**` (any depth).
 */
export function normalizeRelPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function matchSegments(patternParts: string[], pathParts: string[]): boolean {
  let pi = 0;
  let si = 0;
  while (pi < patternParts.length && si < pathParts.length) {
    const p = patternParts[pi] ?? "";
    if (p === "**") {
      if (pi === patternParts.length - 1) return true;
      for (let skip = si; skip <= pathParts.length; skip++) {
        if (matchSegments(patternParts.slice(pi + 1), pathParts.slice(skip))) return true;
      }
      return false;
    }
    const segment = pathParts[si] ?? "";
    if (p.includes("*") || p.includes("?")) {
      const re = new RegExp(
        `^${p
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`,
      );
      if (!re.test(segment)) return false;
    } else if (p !== segment) {
      return false;
    }
    pi += 1;
    si += 1;
  }
  while (pi < patternParts.length && patternParts[pi] === "**") pi += 1;
  return pi === patternParts.length && si === pathParts.length;
}

/** True when `relPath` matches any of the glob patterns. */
export function matchesAnyGlob(relPath: string, globs: readonly string[]): boolean {
  const normalized = normalizeRelPath(relPath);
  const pathParts = normalized.split("/").filter(Boolean);
  for (const glob of globs) {
    const pattern = normalizeRelPath(glob);
    if (matchSegments(pattern.split("/").filter(Boolean), pathParts)) return true;
  }
  return false;
}
