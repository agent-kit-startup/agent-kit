import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST,
  MAX_GIT_FILES,
  MAX_GIT_PATH,
  allowlistConfig,
  applyCorsHeaders,
  buildEditorFileUris,
  isAllowedOrigin,
  isSafeRepoRelativePath,
  joinRepoRoot,
  parseGitStatusShort,
  resolveBindHost,
  resolveDashboardStatic,
} from "../../../../dashboard/lib/guards.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("allowlistConfig", () => {
  it("keeps only allowlisted config keys and drops nested onboarding checks", () => {
    const raw = {
      onboarded: true,
      autoHandoff: false,
      secretToken: "must-not-leak",
      onboarding: {
        status: "complete",
        contractVersion: 2,
        checks: [
          { id: "git", ok: true, detail: "sensitive repo metadata" },
          { id: "hooks", ok: false, detail: "missing pre-commit" },
        ],
      },
      externalPlanReview: { enabled: true, offerOnExhausted: false, model: "hidden" },
      workspaceSkin: {
        default: "night-shift",
        modes: { "run-plan": "night-shift", "continue-plan": "day-shift" },
      },
    };

    const summary = allowlistConfig(raw);

    expect(summary).toEqual({
      onboarded: true,
      autoHandoff: false,
      onboarding: { status: "complete", contractVersion: 2 },
      externalPlanReview: { enabled: true },
      workspaceSkin: {
        default: "night-shift",
        modes: { "run-plan": "night-shift", "continue-plan": "day-shift" },
      },
    });
    expect(summary).not.toHaveProperty("secretToken");
    expect(summary.onboarding).not.toHaveProperty("checks");
    expect(summary.externalPlanReview).not.toHaveProperty("offerOnExhausted");
  });

  it("returns error for invalid config input", () => {
    expect(allowlistConfig(null)).toEqual({ error: "invalid" });
    expect(allowlistConfig([])).toEqual({ error: "invalid" });
  });
});

describe("parseGitStatusShort", () => {
  it("returns bounded file entries with expected shape", () => {
    const output = [
      " M unstaged-only.txt",
      "M  staged-only.txt",
      "A  dashboard/lib/guards.mjs",
      "?? .cursor/HANDOFF.md",
      "R  old-name.md -> new-name.md",
    ].join("\n");

    const parsed = parseGitStatusShort(output);

    expect(parsed.total).toBe(5);
    expect(parsed.truncated).toBe(false);
    expect(parsed.files).toHaveLength(5);

    for (const file of parsed.files) {
      expect(file).toMatchObject({
        path: expect.any(String),
        status: expect.any(String),
        staged: expect.any(Boolean),
        unstaged: expect.any(Boolean),
        untracked: expect.any(Boolean),
      });
      expect(Object.keys(file).sort()).toEqual(
        expect.arrayContaining(["path", "status", "staged", "unstaged", "untracked"]),
      );
      expect(file.path.length).toBeLessThanOrEqual(MAX_GIT_PATH + 1);
    }

    expect(parsed.files[0]).toMatchObject({
      path: "unstaged-only.txt",
      status: " M",
      staged: false,
      unstaged: true,
      untracked: false,
    });
    expect(parsed.files[1]).toMatchObject({
      path: "staged-only.txt",
      staged: true,
      unstaged: false,
    });
    expect(parsed.files[2]).toMatchObject({ staged: true, untracked: false });
    expect(parsed.files[3]).toMatchObject({ untracked: true });
    expect(parsed.files[4]).toMatchObject({
      path: "new-name.md",
      oldPath: "old-name.md",
      renamed: true,
    });
  });

  it("caps files array at MAX_GIT_FILES", () => {
    const lines = Array.from({ length: MAX_GIT_FILES + 5 }, (_, i) => `?? file-${i}.txt`);
    const parsed = parseGitStatusShort(lines.join("\n"));

    expect(parsed.files).toHaveLength(MAX_GIT_FILES);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(MAX_GIT_FILES + 5);
  });
});

describe("resolveBindHost", () => {
  it("defaults to loopback when HOST env is unset", () => {
    expect(resolveBindHost(undefined)).toBe(DEFAULT_HOST);
    expect(DEFAULT_HOST).toBe("127.0.0.1");
  });

  it("honors explicit HOST override", () => {
    expect(resolveBindHost("0.0.0.0")).toBe("0.0.0.0");
  });
});

describe("isAllowedOrigin", () => {
  const port = 3333;

  it("allows localhost and 127.0.0.1 on the configured port", () => {
    expect(isAllowedOrigin("http://localhost:3333", port)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3333", port)).toBe(true);
  });

  it("rejects wrong port and non-loopback hosts", () => {
    expect(isAllowedOrigin("http://localhost:4444", port)).toBe(false);
    expect(isAllowedOrigin("http://evil.example:3333", port)).toBe(false);
    expect(isAllowedOrigin("", port)).toBe(false);
  });
});

describe("applyCorsHeaders", () => {
  it("sets ACAO only for allowed localhost origins", () => {
    const port = 3333;
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    };

    const allowed = applyCorsHeaders({ headers: { origin: "http://127.0.0.1:3333" } }, res, port);
    expect(allowed).toBe(true);
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:3333");
    expect(headers.Vary).toBe("Origin");

    const blockedHeaders: Record<string, string> = {};
    const blockedRes = {
      setHeader(name: string, value: string) {
        blockedHeaders[name] = value;
      },
    };
    const blocked = applyCorsHeaders(
      { headers: { origin: "http://evil.example:3333" } },
      blockedRes,
      port,
    );
    expect(blocked).toBe(false);
    expect(blockedHeaders).toEqual({});
  });
});

describe("resolveDashboardStatic", () => {
  it("resolves files inside dashboard dir and blocks repo escape", () => {
    const tmpDashboard = mkdtempSync(join(tmpdir(), "mc-dashboard-"));
    writeFileSync(join(tmpDashboard, "dashboard.html"), "<html></html>");
    const dashboardReal = realpathSync(tmpDashboard);
    const dashboardDir = dashboardReal;

    const ctx = {
      dashboardDir,
      dashboardReal,
      existsSync,
      realpathSync,
    };

    expect(resolveDashboardStatic("/", ctx)).toBe(join(dashboardReal, "dashboard.html"));
    expect(resolveDashboardStatic("/dashboard.html", ctx)).toBe(
      join(dashboardReal, "dashboard.html"),
    );
    expect(resolveDashboardStatic("/../package.json", ctx)).toBeNull();
    expect(resolveDashboardStatic("/../../etc/passwd", ctx)).toBeNull();
    expect(resolveDashboardStatic("/missing.html", ctx)).toBeNull();
    expect(resolveDashboardStatic("/.hidden", ctx)).toBeNull();
  });

  it("blocks paths outside dashboard/ using real repo layout", () => {
    const dashboardDir = join(repoRoot, "dashboard");
    const dashboardReal = realpathSync(dashboardDir);
    const ctx = {
      dashboardDir,
      dashboardReal,
      existsSync,
      realpathSync,
    };

    expect(resolveDashboardStatic("/dashboard.html", ctx)).toBe(
      join(dashboardReal, "dashboard.html"),
    );
    expect(resolveDashboardStatic("/../package.json", ctx)).toBeNull();
    expect(resolveDashboardStatic("/lib/guards.mjs", ctx)).toBe(
      join(dashboardReal, "lib", "guards.mjs"),
    );
  });
});

describe("repo path + editor URI helpers", () => {
  it("accepts safe relative paths and rejects traversal or absolute forms", () => {
    expect(isSafeRepoRelativePath(".cursor/plans/x.plan.md")).toBe(true);
    expect(isSafeRepoRelativePath(".cursor/HANDOFF.md")).toBe(true);
    expect(isSafeRepoRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRepoRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRepoRelativePath("C:/Windows/system.ini")).toBe(false);
    expect(isSafeRepoRelativePath("https://example.com/x")).toBe(false);
    expect(isSafeRepoRelativePath("")).toBe(false);
  });

  it("joins repo root only for safe relative paths", () => {
    expect(joinRepoRoot("/Users/me/repo", ".cursor/HANDOFF.md")).toBe(
      "/Users/me/repo/.cursor/HANDOFF.md",
    );
    expect(joinRepoRoot("/Users/me/repo/", ".cursor/plans/a.plan.md")).toBe(
      "/Users/me/repo/.cursor/plans/a.plan.md",
    );
    expect(joinRepoRoot("/Users/me/repo", "../secret")).toBeNull();
    expect(joinRepoRoot("", ".cursor/HANDOFF.md")).toBeNull();
  });

  it("builds vscode and cursor file URIs", () => {
    expect(buildEditorFileUris("/Users/me/repo/.cursor/HANDOFF.md")).toEqual({
      vscode: "vscode://file/Users/me/repo/.cursor/HANDOFF.md",
      cursor: "cursor://file/Users/me/repo/.cursor/HANDOFF.md",
    });
    expect(buildEditorFileUris("C:\\Users\\me\\file.md")).toEqual({
      vscode: "vscode://file/C:/Users/me/file.md",
      cursor: "cursor://file/C:/Users/me/file.md",
    });
    expect(buildEditorFileUris("")).toBeNull();
  });
});
