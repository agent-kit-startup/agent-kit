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

  it("ships distinct Legacy and Cursor interface logo assets", () => {
    const legacy = join(dashboardDir, "logo.svg");
    const cursor = join(dashboardDir, "logo-cursor.svg");
    expect(existsSync(legacy)).toBe(true);
    expect(existsSync(cursor)).toBe(true);
    const legacyBody = readFileSync(legacy, "utf8");
    const cursorBody = readFileSync(cursor, "utf8");
    expect(legacyBody).not.toEqual(cursorBody);
    // Cursor skin: stroke helmet mark sized for 16px chrome icons.
    // Hardcoded stroke (not currentColor): #headerLogo is <img>, so currentColor paints black.
    expect(cursorBody).toContain('viewBox="0 0 22.38 22.45"');
    expect(cursorBody).toMatch(/helmet/i);
    expect(cursorBody).toContain('stroke="#e4e4e4"');
    expect(cursorBody).toContain("M9.61,22.1");
    expect(cursorBody).not.toContain('stroke="currentColor"');

    const ctx = {
      dashboardDir,
      dashboardReal,
      existsSync,
      realpathSync,
    };
    expect(resolveDashboardStatic("/logo.svg", ctx)).toBe(join(dashboardReal, "logo.svg"));
    expect(resolveDashboardStatic("/logo-cursor.svg", ctx)).toBe(
      join(dashboardReal, "logo-cursor.svg"),
    );
  });
});
