import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDashboardStatic } from "../../../../dashboard/lib/guards.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardDir = join(repoRoot, "dashboard");
const dashboardReal = realpathSync(dashboardDir);
const panelHtmlPath = join(dashboardDir, "dashboard.html");

/** Local static paths from src/href (root-absolute, not # / http(s) / data / mailto / javascript). */
function extractLocalStaticUrls(html: string): string[] {
  const urls = new Set<string>();
  const attrRe = /\b(?:src|href)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attrRe)) {
    const raw = match[1].trim();
    if (!raw.startsWith("/")) continue;
    if (raw.startsWith("//")) continue;
    urls.add(raw.split("?")[0].split("#")[0]);
  }
  return [...urls].sort();
}

describe("dashboard panel static assets", () => {
  it("resolves every local src/href asset URL to a real file under dashboard/", () => {
    const html = readFileSync(panelHtmlPath, "utf8");
    const urls = extractLocalStaticUrls(html);

    expect(urls.length).toBeGreaterThan(0);

    const ctx = {
      dashboardDir,
      dashboardReal,
      existsSync,
      realpathSync,
    };

    for (const url of urls) {
      const resolved = resolveDashboardStatic(url, ctx);
      expect(resolved, `static URL ${url} must resolve to a file`).not.toBeNull();
      expect(existsSync(resolved as string)).toBe(true);
    }
  });
});
