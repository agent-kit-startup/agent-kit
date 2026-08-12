import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OS_DEFAULT_TOKENS,
  buildOpenBrowserCommand,
  isSafePreferredBrowser,
  normalizePreferredBrowser,
  openBrowser,
  readPreferredBrowserFromConfig,
  resolvePreferredBrowser,
  shouldSkipOpen,
} from "../../../../dashboard/lib/open-browser.mjs";
import { applyDashboardOpenEnv, readPreferredBrowserFromWorkspace } from "../commands/dashboard.js";

describe("normalizePreferredBrowser", () => {
  it("maps empty and sentinel tokens to OS default (null)", () => {
    expect(normalizePreferredBrowser(null)).toBeNull();
    expect(normalizePreferredBrowser("")).toBeNull();
    expect(normalizePreferredBrowser("default")).toBeNull();
    expect(normalizePreferredBrowser("OS")).toBeNull();
    expect(normalizePreferredBrowser("ask")).toBeNull();
    for (const token of OS_DEFAULT_TOKENS) {
      if (!token) continue;
      expect(normalizePreferredBrowser(token)).toBeNull();
    }
  });

  it("keeps named browsers", () => {
    expect(normalizePreferredBrowser("Google Chrome")).toBe("Google Chrome");
    expect(normalizePreferredBrowser("  Firefox  ")).toBe("Firefox");
    expect(normalizePreferredBrowser("msedge")).toBe("msedge");
  });

  it("rejects path separators and shell metacharacters", () => {
    expect(isSafePreferredBrowser("./pwn.sh")).toBe(false);
    expect(isSafePreferredBrowser("/usr/bin/env")).toBe(false);
    expect(isSafePreferredBrowser("C:\\Windows\\chrome.exe")).toBe(false);
    expect(isSafePreferredBrowser("firefox;rm -rf /")).toBe(false);
    expect(isSafePreferredBrowser("$(evil)")).toBe(false);
    expect(isSafePreferredBrowser('a" x "b')).toBe(false);
    expect(isSafePreferredBrowser("%USERPROFILE%")).toBe(false);
    expect(isSafePreferredBrowser("chrome^")).toBe(false);
    expect(isSafePreferredBrowser("bad'quote")).toBe(false);
    expect(normalizePreferredBrowser("./pwn.sh")).toBeNull();
    expect(normalizePreferredBrowser("/usr/bin/env")).toBeNull();
    expect(normalizePreferredBrowser("bad`cmd`")).toBeNull();
  });
});

describe("resolvePreferredBrowser", () => {
  it("prefers env over config", () => {
    expect(
      resolvePreferredBrowser({
        env: { MISSION_CONTROL_PREFERRED_BROWSER: "Firefox" },
        configValue: "Google Chrome",
      }),
    ).toBe("Firefox");
  });

  it("falls back to config when env unset", () => {
    expect(
      resolvePreferredBrowser({
        env: {},
        configValue: "Safari",
      }),
    ).toBe("Safari");
  });

  it("returns null when both unset", () => {
    expect(resolvePreferredBrowser({ env: {}, configValue: null })).toBeNull();
  });

  it("treats unsafe env values as OS default", () => {
    expect(
      resolvePreferredBrowser({
        env: { MISSION_CONTROL_PREFERRED_BROWSER: "../evil" },
        configValue: "Firefox",
      }),
    ).toBeNull();
  });
});

describe("shouldSkipOpen / openBrowser no-open", () => {
  it("skips when MISSION_CONTROL_NO_OPEN=1", () => {
    expect(shouldSkipOpen({ MISSION_CONTROL_NO_OPEN: "1" })).toBe(true);
    const spawnFn = vi.fn();
    const result = openBrowser("http://127.0.0.1:3333/", {
      env: { MISSION_CONTROL_NO_OPEN: "1" },
      spawnFn,
    });
    expect(result).toEqual({ opened: false, reason: "no-open" });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe("buildOpenBrowserCommand", () => {
  it("uses open -a on darwin when preferred is set", () => {
    expect(
      buildOpenBrowserCommand({
        url: "http://127.0.0.1:3333/",
        preferred: "Google Chrome",
        platform: "darwin",
      }),
    ).toEqual({
      command: "open",
      args: ["-a", "Google Chrome", "http://127.0.0.1:3333/"],
    });
  });

  it("uses bare open on darwin when preferred is null", () => {
    expect(
      buildOpenBrowserCommand({
        url: "http://127.0.0.1:3333/",
        preferred: null,
        platform: "darwin",
      }),
    ).toEqual({ command: "open", args: ["http://127.0.0.1:3333/"] });
  });

  it("uses preferred binary on linux", () => {
    expect(
      buildOpenBrowserCommand({
        url: "http://127.0.0.1:3333/",
        preferred: "firefox",
        platform: "linux",
      }),
    ).toEqual({ command: "firefox", args: ["http://127.0.0.1:3333/"] });
  });

  it("uses xdg-open on linux when preferred is null", () => {
    expect(
      buildOpenBrowserCommand({
        url: "http://127.0.0.1:3333/",
        preferred: null,
        platform: "linux",
      }),
    ).toEqual({ command: "xdg-open", args: ["http://127.0.0.1:3333/"] });
  });

  it("uses cmd start with program name on win32 when preferred is set", () => {
    expect(
      buildOpenBrowserCommand({
        url: "http://127.0.0.1:3333/",
        preferred: "msedge",
        platform: "win32",
      }),
    ).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "msedge", "http://127.0.0.1:3333/"],
    });
  });

  it("uses bare cmd start on win32 when preferred is null", () => {
    expect(
      buildOpenBrowserCommand({
        url: "http://127.0.0.1:3333/",
        preferred: null,
        platform: "win32",
      }),
    ).toEqual({ command: "cmd", args: ["/c", "start", "", "http://127.0.0.1:3333/"] });
  });

  it("returns null for invalid url", () => {
    expect(buildOpenBrowserCommand({ url: "", preferred: null, platform: "darwin" })).toBeNull();
    expect(buildOpenBrowserCommand({ url: "   ", preferred: null, platform: "linux" })).toBeNull();
  });
});

describe("openBrowser spawn", () => {
  it("spawns exactly one process with resolved args", () => {
    const child = { unref: vi.fn(), on: vi.fn() };
    const spawnFn = vi.fn(() => child);
    const result = openBrowser("http://127.0.0.1:3511/", {
      env: {},
      preferred: "Google Chrome",
      platform: "darwin",
      spawnFn,
    });
    expect(result.opened).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith(
      "open",
      ["-a", "Google Chrome", "http://127.0.0.1:3511/"],
      { detached: true, stdio: "ignore" },
    );
    expect(child.unref).toHaveBeenCalled();
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("falls back to OS default when preferred spawn throws", () => {
    const child = { unref: vi.fn(), on: vi.fn() };
    const spawnFn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      })
      .mockImplementationOnce(() => child);
    const result = openBrowser("http://127.0.0.1:3511/", {
      env: {},
      preferred: "NoSuchBrowser",
      platform: "linux",
      spawnFn,
    });
    expect(result.opened).toBe(true);
    expect(result.reason).toBe("preferred-fallback");
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(spawnFn.mock.calls[1]?.[0]).toBe("xdg-open");
  });

  it("returns spawn-failed when preferred and fallback both fail", () => {
    const spawnFn = vi.fn(() => {
      throw new Error("spawn failed");
    });
    const result = openBrowser("http://127.0.0.1:3511/", {
      env: {},
      preferred: "bad-bin",
      platform: "linux",
      spawnFn,
    });
    expect(result.opened).toBe(false);
    expect(result.reason).toBe("spawn-failed");
  });

  it("returns invalid-url for empty url", () => {
    const spawnFn = vi.fn();
    expect(openBrowser("", { env: {}, spawnFn })).toEqual({
      opened: false,
      reason: "invalid-url",
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("uses spawnSyncFn for darwin preferred and falls back on non-zero exit", () => {
    const spawnSyncFn = vi
      .fn()
      .mockReturnValueOnce({ status: 1, error: null })
      .mockReturnValueOnce({ status: 0, error: null });
    const result = openBrowser("http://127.0.0.1:3511/", {
      env: {},
      preferred: "NoSuchBrowser.app",
      platform: "darwin",
      spawnSyncFn,
    });
    expect(result.opened).toBe(true);
    expect(result.reason).toBe("preferred-fallback");
    expect(spawnSyncFn).toHaveBeenNthCalledWith(
      1,
      "open",
      ["-a", "NoSuchBrowser.app", "http://127.0.0.1:3511/"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(spawnSyncFn).toHaveBeenNthCalledWith(
      2,
      "open",
      ["http://127.0.0.1:3511/"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("uses spawnSyncFn which-probe for linux preferred miss then falls back", () => {
    const child = { unref: vi.fn(), on: vi.fn() };
    const spawnFn = vi.fn(() => child);
    const spawnSyncFn = vi
      .fn()
      .mockReturnValueOnce({ status: 1, error: null })
      .mockReturnValueOnce({ status: 0, error: null });
    const result = openBrowser("http://127.0.0.1:3511/", {
      env: {},
      preferred: "nosuch-browser",
      platform: "linux",
      spawnFn,
      spawnSyncFn,
    });
    expect(result.opened).toBe(true);
    expect(result.reason).toBe("preferred-fallback");
    expect(spawnSyncFn).toHaveBeenNthCalledWith(
      1,
      "which",
      ["nosuch-browser"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(spawnSyncFn).toHaveBeenNthCalledWith(
      2,
      "which",
      ["xdg-open"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(spawnFn).toHaveBeenCalledWith("xdg-open", ["http://127.0.0.1:3511/"], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("reports spawn-failed when win32 preferred spawnSync exits non-zero and fallback also fails", () => {
    const spawnSyncFn = vi.fn(() => ({ status: 1, error: null }));
    const result = openBrowser("http://127.0.0.1:3511/", {
      env: {},
      preferred: "msedge",
      platform: "win32",
      spawnSyncFn,
    });
    expect(result.opened).toBe(false);
    expect(result.reason).toBe("spawn-failed");
    expect(spawnSyncFn).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "msedge", "http://127.0.0.1:3511/"],
      expect.objectContaining({ encoding: "utf8", windowsHide: true }),
    );
    expect(spawnSyncFn).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "http://127.0.0.1:3511/"],
      expect.objectContaining({ encoding: "utf8", windowsHide: true }),
    );
  });

  it("reports spawn-failed when OS-default linux which-probe misses xdg-open", () => {
    const spawnFn = vi.fn();
    const spawnSyncFn = vi.fn(() => ({ status: 1, error: null }));
    const result = openBrowser("http://127.0.0.1:3511/", {
      env: {},
      preferred: null,
      platform: "linux",
      spawnFn,
      spawnSyncFn,
    });
    expect(result).toEqual({
      opened: false,
      reason: "spawn-failed",
      command: "xdg-open",
      args: ["http://127.0.0.1:3511/"],
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe("readPreferredBrowserFromConfig", () => {
  it("reads missionControl.preferredBrowser from JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ak-pref-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ missionControl: { preferredBrowser: "Firefox" } }));
    expect(readPreferredBrowserFromConfig(configPath)).toBe("Firefox");
  });

  it("returns null for missing file", () => {
    expect(readPreferredBrowserFromConfig(join(tmpdir(), "no-such-config.json"))).toBeNull();
  });
});

describe("applyDashboardOpenEnv / workspace reader", () => {
  it("sets NO_OPEN and --browser flag", () => {
    const env = applyDashboardOpenEnv({}, { noOpen: true, browser: "Safari" });
    expect(env.MISSION_CONTROL_NO_OPEN).toBe("1");
    expect(env.MISSION_CONTROL_PREFERRED_BROWSER).toBe("Safari");
  });

  it("drops unsafe --browser values", () => {
    const env = applyDashboardOpenEnv({}, { browser: "./pwn.sh" });
    expect(env.MISSION_CONTROL_PREFERRED_BROWSER).toBeUndefined();
  });

  it("loads preferred browser from workspace config when flag absent", () => {
    const root = mkdtempSync(join(tmpdir(), "ak-ws-pref-"));
    mkdirSync(join(root, ".cursor", "context"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "context", "config.json"),
      JSON.stringify({ missionControl: { preferredBrowser: "Brave Browser" } }),
    );
    expect(readPreferredBrowserFromWorkspace(root)).toBe("Brave Browser");
    const env = applyDashboardOpenEnv({}, { cwd: root });
    expect(env.MISSION_CONTROL_PREFERRED_BROWSER).toBe("Brave Browser");
  });

  it("CLI workspace reader shares OS_DEFAULT_TOKENS / normalize SoT with the helper", () => {
    expect(normalizePreferredBrowser("default")).toBeNull();
    expect(normalizePreferredBrowser("ask")).toBeNull();
    expect(OS_DEFAULT_TOKENS.has("os")).toBe(true);
    const root = mkdtempSync(join(tmpdir(), "ak-ws-sentinel-"));
    mkdirSync(join(root, ".cursor", "context"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "context", "config.json"),
      JSON.stringify({ missionControl: { preferredBrowser: "os" } }),
    );
    expect(readPreferredBrowserFromWorkspace(root)).toBeNull();
  });
});
