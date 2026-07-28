import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdates,
  compareSemver,
  isFactoryOrDevRegistry,
  normalizeSemver,
  pickLatestSemverTag,
  readUpdateApplyPrefs,
  readUpdateCheckPrefs,
} from "./check-updates.js";

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
});
