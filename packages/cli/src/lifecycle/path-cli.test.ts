import { describe, expect, it, vi } from "vitest";
import type { EnvironmentReport } from "../readiness/env-checks.js";
import { npxPinned, pathCliStatus, syncPathCliToRuntime } from "./path-cli.js";

function makeEnv(overrides: Partial<EnvironmentReport> = {}): EnvironmentReport {
  return {
    binOnPath: false,
    binPath: null,
    binVersion: null,
    npmPrefixWritable: true,
    npmPrefix: { prefix: "/usr/local", writable: true, source: "heuristic" },
    nodeVersionOk: true,
    nodeVersion: "v20.11.0",
    shell: "zsh",
    shellProfile: "/home/user/.zshrc",
    ...overrides,
  };
}

describe("pathCliStatus", () => {
  it("is current when PATH version is this CLI", () => {
    expect(
      pathCliStatus(
        makeEnv({
          binOnPath: true,
          binPath: "/usr/local/bin/agent-kit",
          binVersion: "5.8.0",
        }),
        "5.8.0",
      ),
    ).toBe("current");
  });

  it("is behind when PATH is older than this CLI", () => {
    expect(
      pathCliStatus(
        makeEnv({
          binOnPath: true,
          binPath: "/Users/macos/Library/pnpm/agent-kit",
          binVersion: "5.7.0",
        }),
        "5.8.0",
      ),
    ).toBe("behind");
  });
});

describe("syncPathCliToRuntime", () => {
  it("does not install globally in non-interactive mode; prints the npx pin", async () => {
    const npmInstallImpl = vi.fn();
    const result = await syncPathCliToRuntime({
      runtimeVersion: "5.8.0",
      autoInstall: false,
      npmInstallImpl,
      env: makeEnv({
        binOnPath: true,
        binPath: "/Users/macos/Library/pnpm/agent-kit",
        binVersion: "5.7.0",
        npmPrefix: { prefix: "/usr/local", writable: true, source: "heuristic" },
      }),
    });
    expect(npmInstallImpl).not.toHaveBeenCalled();
    expect(result.upgraded).toBe(false);
    expect(result.status).toBe("behind");
    expect(result.lines.join("\n")).toContain(npxPinned("5.8.0", "update"));
    expect(result.lines.join("\n")).toContain("Do not run bare `agent-kit update`");
  });

  it("installs the pinned spec when interactive and prefix is writable", async () => {
    const npmInstallImpl = vi.fn(async () => ({ ok: true }));
    const current = makeEnv({
      binOnPath: true,
      binPath: "/usr/local/bin/agent-kit",
      binVersion: "5.8.0",
    });
    const result = await syncPathCliToRuntime({
      runtimeVersion: "5.8.0",
      autoInstall: true,
      npmInstallImpl,
      env: makeEnv({
        binOnPath: true,
        binPath: "/usr/local/bin/agent-kit",
        binVersion: "5.7.0",
      }),
      assessEnvironmentImpl: async () => current,
    });
    expect(npmInstallImpl).toHaveBeenCalledWith("@dadado/agent-kit-cli@5.8.0");
    expect(result.upgraded).toBe(true);
    expect(result.status).toBe("current");
  });

  it("is missing when PATH has no agent-kit", () => {
    expect(pathCliStatus(makeEnv({ binOnPath: false, binPath: null }), "5.8.0")).toBe("missing");
  });

  it("does not install when PATH already matches", async () => {
    const npmInstallImpl = vi.fn();
    const result = await syncPathCliToRuntime({
      runtimeVersion: "5.8.0",
      autoInstall: true,
      npmInstallImpl,
      env: makeEnv({
        binOnPath: true,
        binPath: "/usr/local/bin/agent-kit",
        binVersion: "5.8.0",
      }),
    });
    expect(npmInstallImpl).not.toHaveBeenCalled();
    expect(result.upgraded).toBe(false);
    expect(result.lines).toEqual([]);
  });

  it("prints setup-global instead of npm i -g when the prefix is not writable", async () => {
    const npmInstallImpl = vi.fn();
    const result = await syncPathCliToRuntime({
      runtimeVersion: "5.8.0",
      autoInstall: true,
      npmInstallImpl,
      env: makeEnv({
        binOnPath: false,
        npmPrefixWritable: false,
        npmPrefix: { prefix: "/usr/local", writable: false, source: "heuristic" },
      }),
    });
    expect(npmInstallImpl).not.toHaveBeenCalled();
    expect(result.upgraded).toBe(false);
    expect(result.lines.join("\n")).toContain(npxPinned("5.8.0", "setup-global"));
  });

  it("warns that npm i -g will not replace a pnpm shadow", async () => {
    const result = await syncPathCliToRuntime({
      runtimeVersion: "5.8.0",
      autoInstall: false,
      env: makeEnv({
        binOnPath: true,
        binPath: "/Users/macos/Library/pnpm/agent-kit",
        binVersion: "5.7.0",
        npmPrefix: { prefix: "/usr/local", writable: true, source: "heuristic" },
      }),
    });
    expect(result.lines.join("\n")).toContain("which -a agent-kit");
    expect(result.lines.join("\n")).toContain("not npm's global bin");
  });
});
