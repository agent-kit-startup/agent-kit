import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdates,
  checkRunningCliVsNpmLatest,
  compareSemver,
  fetchLatestNpmDistTag,
  isFactoryOrDevRegistry,
  normalizeSemver,
  pickLatestSemverTag,
  readUpdateApplyPrefs,
  readUpdateCheckPrefs,
  warnIfRunningCliBehindNpm,
} from "./check-updates.js";
import { KIT_VERSION } from "./version.js";

describe("compareSemver / normalizeSemver", () => {
  it("compares core versions", () => {
    expect(compareSemver("4.7.0", "4.7.2")).toBe(-1);
    expect(compareSemver("v4.7.2", "4.7.2")).toBe(0);
    expect(compareSemver("5.0.0", "4.9.9")).toBe(1);
  });

  it("normalizes leading v and strips prerelease for core", () => {
    expect(normalizeSemver("v4.7.2")).toBe("4.7.2");
    expect(normalizeSemver("4.7.2-beta.1")).toBe("4.7.2");
    expect(normalizeSemver("not-a-version")).toBeNull();
  });
});

const DEFAULT_PUBLIC = "https://github.com/agent-kit-startup/agent-kit";

describe("isFactoryOrDevRegistry", () => {
  it("detects agent-kit-dev URL", () => {
    expect(
      isFactoryOrDevRegistry("https://github.com/agent-kit-startup/agent-kit-dev", "main"),
    ).toBe(true);
  });

  it("detects staging/develop refs", () => {
    expect(
      isFactoryOrDevRegistry("https://github.com/agent-kit-startup/agent-kit", "staging"),
    ).toBe(true);
    expect(isFactoryOrDevRegistry(DEFAULT_PUBLIC, "develop")).toBe(true);
  });

  it("allows public consumer registry", () => {
    expect(isFactoryOrDevRegistry(DEFAULT_PUBLIC, "main")).toBe(false);
    expect(isFactoryOrDevRegistry(null, "v4.7.2")).toBe(false);
  });
});

describe("pickLatestSemverTag", () => {
  it("picks highest tag and ignores peeled refs", () => {
    const stdout = [
      "abc\trefs/tags/v4.6.0",
      "def\trefs/tags/v4.7.2",
      "def\trefs/tags/v4.7.2^{}",
      "ghi\trefs/tags/v4.7.1",
      "jkl\trefs/tags/not-semver",
    ].join("\n");
    expect(pickLatestSemverTag(stdout)).toBe("4.7.2");
  });
});

describe("readUpdateCheckPrefs / readUpdateApplyPrefs", () => {
  it("defaults updateCheck to opt-in false", () => {
    expect(readUpdateCheckPrefs(null)).toEqual({
      enabled: false,
      intervalDays: 7,
      lastCheckedAt: null,
    });
    expect(readUpdateCheckPrefs({ updateCheck: { enabled: true, intervalDays: 3 } })).toEqual({
      enabled: true,
      intervalDays: 3,
      lastCheckedAt: null,
    });
  });

  it("defaults updateApply.auto to false", () => {
    expect(readUpdateApplyPrefs({})).toEqual({ auto: false });
    expect(readUpdateApplyPrefs({ updateApply: { auto: true } })).toEqual({ auto: true });
    expect(readUpdateApplyPrefs({ updateApply: { auto: "yes" } })).toEqual({ auto: false });
  });
});

describe("checkForUpdates", () => {
  const temps: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function writeManifest(
    cwd: string,
    version: string,
    registry?: { url: string; ref: string },
  ) {
    await mkdir(path.join(cwd, ".cursor"), { recursive: true });
    await writeFile(
      path.join(cwd, ".cursor", "agent-kit.json"),
      JSON.stringify({
        schemaVersion: 1,
        version,
        packs: [],
        skills: [],
        protected: [],
        ...(registry ? { registry } : {}),
      }),
      "utf8",
    );
  }

  async function writeConfig(cwd: string, config: unknown) {
    await mkdir(path.join(cwd, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(cwd, ".cursor", "context", "config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );
  }

  it("skips factory/dev registry without network", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    await writeManifest(cwd, "4.7.2", {
      url: "https://github.com/agent-kit-startup/agent-kit-dev",
      ref: "staging",
    });
    const result = await checkForUpdates(cwd, { latestVersion: "9.9.9" });
    expect(result.status).toBe("skipped-factory");
    expect(result.applyRecommended).toBe(false);
  });

  it("names the binary upgrade when the CLI itself is behind the latest tag", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    await writeManifest(cwd, "4.7.0", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    // Latest tag ahead of this CLI: /update alone would re-apply KIT_VERSION,
    // so the message must not stop at "Run /update".
    const result = await checkForUpdates(cwd, { latestVersion: "999.0.0" });
    expect(result.status).toBe("update-available");
    expect(result.message).toContain("npm i -g @dadado/agent-kit-cli@999.0.0");
    expect(result.message).toContain(KIT_VERSION);
  });

  it("keeps the plain apply hint when the CLI is current", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    await writeManifest(cwd, "0.1.0", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    // Manifest behind, but this CLI can deliver the target: no upgrade nag.
    const result = await checkForUpdates(cwd, { latestVersion: KIT_VERSION });
    expect(result.status).toBe("update-available");
    expect(result.message).toContain("Run /update (Ask confirm) to apply; never silent.");
    expect(result.message).not.toContain("npm i -g");
  });

  it("reports update-available when latest is newer (notify-only)", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    await writeManifest(cwd, "4.7.0", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    const result = await checkForUpdates(cwd, { latestVersion: "4.7.2" });
    expect(result.status).toBe("update-available");
    expect(result.installedVersion).toBe("4.7.0");
    expect(result.latestVersion).toBe("4.7.2");
    expect(result.applyRecommended).toBe(false);
    expect(result.message).toMatch(/\/update/);
  });

  it("reports up-to-date", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    await writeManifest(cwd, "4.7.2", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    const result = await checkForUpdates(cwd, { latestVersion: "4.7.2" });
    expect(result.status).toBe("up-to-date");
    expect(result.applyRecommended).toBe(false);
  });

  it("respects opt-out (enabled false)", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    await writeManifest(cwd, "4.7.0", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    await writeConfig(cwd, { updateCheck: { enabled: false } });
    const result = await checkForUpdates(cwd, {
      respectPrefs: true,
      latestVersion: "9.0.0",
    });
    expect(result.status).toBe("skipped-disabled");
  });

  it("respects interval throttle", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    await writeManifest(cwd, "4.7.0", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    await writeConfig(cwd, {
      updateCheck: {
        enabled: true,
        intervalDays: 7,
        lastCheckedAt: new Date().toISOString(),
      },
    });
    const result = await checkForUpdates(cwd, {
      respectPrefs: true,
      latestVersion: "9.0.0",
    });
    expect(result.status).toBe("skipped-interval");
  });

  it("skips when no manifest", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-"));
    temps.push(cwd);
    const result = await checkForUpdates(cwd);
    expect(result.status).toBe("skipped-no-manifest");
  });

  it("compares --registry local checkout instead of public tags", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-consumer-"));
    const kit = await mkdtemp(path.join(tmpdir(), "ak-check-kit-"));
    temps.push(cwd, kit);
    await writeManifest(cwd, "5.0.0", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    await mkdir(path.join(kit, "registry"), { recursive: true });
    await writeFile(path.join(kit, "registry", "registry.json"), "{}\n", "utf8");
    await mkdir(path.join(kit, "packages", "cli"), { recursive: true });
    await writeFile(
      path.join(kit, "packages", "cli", "package.json"),
      JSON.stringify({ version: "5.1.0" }),
      "utf8",
    );

    const result = await checkForUpdates(cwd, { registryPath: kit });
    expect(result.status).toBe("update-available");
    expect(result.installedVersion).toBe("5.0.0");
    expect(result.latestVersion).toBe("5.1.0");
    expect(result.registryUrl).toBe(path.resolve(kit));
    expect(result.registryRef).toBe("local");
    expect(result.message).not.toMatch(/public/i);
    expect(result.applyRecommended).toBe(false);
  });

  it("does not report public up-to-date when local --registry L0 drifted", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-check-drift-c-"));
    const kit = await mkdtemp(path.join(tmpdir(), "ak-check-drift-k-"));
    temps.push(cwd, kit);
    await writeManifest(cwd, "5.0.0", {
      url: "https://github.com/agent-kit-startup/agent-kit",
      ref: "main",
    });
    await mkdir(path.join(kit, "registry"), { recursive: true });
    await writeFile(path.join(kit, "registry", "registry.json"), "{}\n", "utf8");
    await mkdir(path.join(kit, "packages", "cli"), { recursive: true });
    await writeFile(
      path.join(kit, "packages", "cli", "package.json"),
      JSON.stringify({ version: "5.0.0" }),
      "utf8",
    );
    const rel = path.join(".cursor", "rules", "cursor-plan-handoff.mdc");
    await mkdir(path.join(kit, ".cursor", "rules"), { recursive: true });
    await mkdir(path.join(cwd, ".cursor", "rules"), { recursive: true });
    await writeFile(path.join(kit, rel), "# kit newer\n", "utf8");
    await writeFile(path.join(cwd, rel), "# consumer older\n", "utf8");

    const result = await checkForUpdates(cwd, { registryPath: kit });
    expect(result.status).toBe("update-available");
    expect(result.registryUrl).toBe(path.resolve(kit));
    expect(result.registryRef).toBe("local");
    expect(result.message).not.toMatch(/public/i);
    expect(result.message).toMatch(/drift/i);
  });
});

describe("checkRunningCliVsNpmLatest", () => {
  const temps: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function writeConfig(cwd: string, config: unknown) {
    await mkdir(path.join(cwd, ".cursor", "context"), { recursive: true });
    await writeFile(
      path.join(cwd, ".cursor", "context", "config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );
  }

  it("skips when updateCheck is disabled (no fetch)", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-cli-ver-"));
    temps.push(cwd);
    await writeConfig(cwd, { updateCheck: { enabled: false } });
    const fetchLatest = vi.fn(async () => "9.9.9");
    const result = await checkRunningCliVsNpmLatest(cwd, { respectPrefs: true, fetchLatest });
    expect(result.status).toBe("skipped-disabled");
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("skips within interval (no fetch)", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-cli-ver-"));
    temps.push(cwd);
    await writeConfig(cwd, {
      updateCheck: {
        enabled: true,
        intervalDays: 7,
        lastCheckedAt: new Date().toISOString(),
      },
    });
    const fetchLatest = vi.fn(async () => "9.9.9");
    const result = await checkRunningCliVsNpmLatest(cwd, { respectPrefs: true, fetchLatest });
    expect(result.status).toBe("skipped-interval");
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("reports behind vs injected npm latest without a manifest", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-cli-ver-"));
    temps.push(cwd);
    const result = await checkRunningCliVsNpmLatest(cwd, { latestVersion: "999.0.0" });
    expect(result.status).toBe("behind");
    expect(result.runningVersion).toBe(normalizeSemver(KIT_VERSION));
    expect(result.latestVersion).toBe("999.0.0");
    expect(result.message).toContain("npx @dadado/agent-kit-cli@latest");
    expect(result.message).toContain("npm i -g @dadado/agent-kit-cli@999.0.0");
  });

  it("reports up-to-date when npm latest matches KIT_VERSION", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-cli-ver-"));
    temps.push(cwd);
    const result = await checkRunningCliVsNpmLatest(cwd, { latestVersion: KIT_VERSION });
    expect(result.status).toBe("up-to-date");
  });

  it("reports ahead when this binary is newer than npm latest", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-cli-ver-"));
    temps.push(cwd);
    const result = await checkRunningCliVsNpmLatest(cwd, { latestVersion: "0.0.1" });
    expect(result.status).toBe("ahead");
  });

  it("warnIfRunningCliBehindNpm prints only when behind", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "ak-cli-ver-"));
    temps.push(cwd);
    const warnings: string[] = [];
    const behind = await warnIfRunningCliBehindNpm(cwd, {
      respectPrefs: false,
      stamp: false,
      latestVersion: "999.0.0",
      warn: (message) => warnings.push(message),
    });
    expect(behind.status).toBe("behind");
    expect(warnings).toHaveLength(1);
    warnings.length = 0;
    const current = await warnIfRunningCliBehindNpm(cwd, {
      respectPrefs: false,
      stamp: false,
      latestVersion: KIT_VERSION,
      warn: (message) => warnings.push(message),
    });
    expect(current.status).toBe("up-to-date");
    expect(warnings).toHaveLength(0);
  });

  it("parses npm latest JSON via fetchLatestNpmDistTag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "5.7.0" }),
      })),
    );
    await expect(fetchLatestNpmDistTag()).resolves.toBe("5.7.0");
  });

  it("returns null from fetchLatestNpmDistTag on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({}),
      })),
    );
    await expect(fetchLatestNpmDistTag()).resolves.toBeNull();
  });
});
