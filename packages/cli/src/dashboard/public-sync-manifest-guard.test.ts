import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardTestsDir = join(repoRoot, "packages/cli/src/dashboard");
const manifestPath = join(repoRoot, "scripts/public-sync.manifest");

/** Same glob semantics as scripts/sync-public.mjs. */
function globToRegex(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${re}$`);
}

function parseManifest(filepath: string): { includes: string[]; excludes: string[] } {
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const raw of readFileSync(filepath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) excludes.push(line.slice(1));
    else includes.push(line);
  }
  return { includes, excludes };
}

function isAllowlisted(
  relPath: string,
  manifest: { includes: string[]; excludes: string[] },
): boolean {
  const included = manifest.includes.some((p) => globToRegex(p).test(relPath));
  if (!included) return false;
  return !manifest.excludes.some((p) => globToRegex(p).test(relPath));
}

function extractLocalStaticUrls(html: string): string[] {
  const urls = new Set<string>();
  const attrRe = /\b(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attrRe)) {
    const raw = match[1].trim();
    if (!raw.startsWith("/")) continue;
    if (raw.startsWith("//")) continue;
    urls.add(raw.split("?")[0].split("#")[0]);
  }
  return [...urls];
}

/** Repo-relative dashboard paths required by synced CLI dashboard tests. */
function collectRequiredDashboardPaths(testSources: string[]): string[] {
  const required = new Set<string>();

  for (const source of testSources) {
    for (const match of source.matchAll(/from\s+["'](?:\.\.\/)+dashboard\/([^"']+)["']/g)) {
      required.add(`dashboard/${match[1]}`);
    }
    for (const match of source.matchAll(
      /(?:resolve|join)\(\s*repoRoot\s*,\s*["']dashboard\/([^"']+)["']\s*\)/g,
    )) {
      required.add(`dashboard/${match[1]}`);
    }
    for (const match of source.matchAll(
      /join\(\s*(?:dashboardDir|dashboardReal)\s*,\s*["']([^"']+)["']\s*\)/g,
    )) {
      required.add(`dashboard/${match[1]}`);
    }
    for (const match of source.matchAll(/join\(\s*repoRoot\s*,\s*["']dashboard["']\s*\)/g)) {
      void match;
      required.add("dashboard");
    }
  }

  // Tests that read panel HTML also require every local static asset under dashboard/.
  for (const source of testSources) {
    const htmlReads = [
      ...source.matchAll(
        /(?:resolve|join)\(\s*repoRoot\s*,\s*["']dashboard\/([^"']+\.html)["']\s*\)/g,
      ),
      ...source.matchAll(
        /join\(\s*(?:dashboardDir|dashboardReal)\s*,\s*["']([^"']+\.html)["']\s*\)/g,
      ),
    ];
    for (const match of htmlReads) {
      const htmlRel = match[1].startsWith("dashboard/") ? match[1] : `dashboard/${match[1]}`;
      required.add(htmlRel);
      const htmlAbs = join(repoRoot, htmlRel);
      try {
        const html = readFileSync(htmlAbs, "utf8");
        for (const url of extractLocalStaticUrls(html)) {
          required.add(`dashboard${url}`);
        }
      } catch {
        // Missing HTML is a separate failure; allowlist guard still lists the path.
      }
    }
  }

  return [...required].sort();
}

describe("public-sync dashboard allowlist guard", () => {
  it("allowlists every dashboard path required by packages/cli/src/dashboard/*.test.ts", () => {
    // Manifest is private-factory only; public mirror never receives it.
    if (!existsSync(manifestPath)) {
      return;
    }

    const testFiles = readdirSync(dashboardTestsDir)
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => join(dashboardTestsDir, name));

    expect(testFiles.length).toBeGreaterThan(0);

    const sources = testFiles.map((file) => readFileSync(file, "utf8"));
    const required = collectRequiredDashboardPaths(sources);
    const manifest = parseManifest(manifestPath);

    expect(required.length).toBeGreaterThan(0);

    const missing = required.filter((relPath) => {
      // Directory marker from join(repoRoot, "dashboard") is covered by dashboard/**
      if (relPath === "dashboard") {
        return !manifest.includes.some((p) => p === "dashboard/**" || p === "dashboard");
      }
      return !isAllowlisted(relPath, manifest);
    });

    expect(missing, `Missing from public-sync.manifest:\n${missing.join("\n")}`).toEqual([]);
  });
});
