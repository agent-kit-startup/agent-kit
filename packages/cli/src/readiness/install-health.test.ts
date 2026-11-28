import { describe, expect, it, vi } from "vitest";
import {
  assessGlobalCli,
  assessHomeInstall,
  assessInstallHealth,
  assessNodeManager,
  assessRegistryPin,
  classifyNodeManagerPath,
  homeRelative,
  miseToolEntry,
  npmLatestCheckAllowed,
  packageForBin,
} from "./install-health.js";

const HOME = "/home/op";

describe("classifyNodeManagerPath", () => {
  it.each([
    // mise (POSIX) and its realpath into the package
    ["/home/op/.local/share/mise/installs/node/26.8.2/bin/agent-kit", "linux", "mise", "26.8.2"],
    [
      "/home/op/.local/share/mise/installs/node/26.8.2/lib/node_modules/@dadado/agent-kit-cli/dist/index.js",
      "linux",
      "mise",
      "26.8.2",
    ],
    // mise (Windows: no bin/ segment)
    [
      "C:\\Users\\op\\AppData\\Local\\mise\\installs\\node\\22.12.0\\agent-kit.cmd",
      "win32",
      "mise",
      "22.12.0",
    ],
    // nvm
    ["/home/op/.nvm/versions/node/v22.12.0/bin/agent-kit", "linux", "nvm", "v22.12.0"],
    ["/Users/op/.nvm/versions/node/v24.1.0/bin/missionkit", "darwin", "nvm", "v24.1.0"],
    // fnm (realpath of the fnm_multishells PATH entry)
    [
      "/home/op/.local/share/fnm/node-versions/v22.12.0/installation/bin/agent-kit",
      "linux",
      "fnm",
      "v22.12.0",
    ],
    [
      "/Users/op/Library/Application Support/fnm/node-versions/v24.0.0/installation/bin/agent-kit",
      "darwin",
      "fnm",
      "v24.0.0",
    ],
    [
      "C:\\Users\\op\\AppData\\Roaming\\fnm\\node-versions\\v22.12.0\\installation\\agent-kit.cmd",
      "win32",
      "fnm",
      "v22.12.0",
    ],
    // nvm-windows (realpath of the NVM_SYMLINK junction)
    [
      "C:\\Users\\op\\AppData\\Roaming\\nvm\\v22.12.0\\agent-kit.cmd",
      "win32",
      "nvm-windows",
      "v22.12.0",
    ],
  ] as const)("%s (%s) -> %s %s", (p, platform, manager, version) => {
    expect(classifyNodeManagerPath(p, platform)).toEqual({ manager, nodeVersion: version });
  });

  it.each([
    // A CLI installed by the recommended mise tool entry is clean.
    [
      "/home/op/.local/share/mise/installs/npm-dadado-agent-kit-cli/6.22.1/bin/agent-kit",
      "linux",
      "other",
    ],
    ["/home/op/.local/share/mise/shims/agent-kit", "linux", "mise-shim"],
    ["/home/op/.volta/bin/agent-kit", "linux", "volta"],
    ["C:\\Users\\op\\AppData\\Local\\Volta\\bin\\agent-kit.cmd", "win32", "volta"],
    ["/opt/homebrew/bin/agent-kit", "darwin", "homebrew"],
    ["/usr/local/Cellar/node/24.0.0/bin/agent-kit", "darwin", "homebrew"],
    ["/home/linuxbrew/.linuxbrew/bin/agent-kit", "linux", "homebrew"],
    ["/usr/bin/agent-kit", "linux", "other"],
    ["/usr/local/bin/agent-kit", "linux", "other"],
    // A POSIX path with an `nvm/vX` segment is not nvm-windows.
    ["/srv/nvm/v22.12.0/bin/agent-kit", "linux", "other"],
  ] as const)("%s (%s) -> %s, not flagged", (p, platform, manager) => {
    expect(classifyNodeManagerPath(p, platform).manager).toBe(manager);
  });
});

describe("assessNodeManager", () => {
  it("mise: warns and prints the exact mise tool entry; names the orphaned version", () => {
    const result = assessNodeManager({
      binPath: `${HOME}/.local/share/mise/installs/node/26.8.2/bin/agent-kit`,
      binRealPath: `${HOME}/.local/share/mise/installs/node/26.8.2/lib/node_modules/@dadado/agent-kit-cli/dist/index.js`,
      nodeExecPath: `${HOME}/.local/share/mise/installs/node/26.13.1/bin/node`,
      platform: "linux",
      homeDir: HOME,
    });
    expect(result.severity).toBe("warning");
    expect(result.fixKind).toBe("config-line");
    expect(result.fix).toBe(
      '"npm:@dadado/agent-kit-cli" = { version = "latest", allow_low_downloads = true, minimum_release_age = "0s" }',
    );
    expect(result.detail).toContain("~/.local/share/mise/installs/node/26.8.2/bin/agent-kit");
    expect(result.detail).toContain("node now resolves to 26.13.1");
    expect(result.detail).toContain("~/.config/mise/config.toml");
    expect(result.detail).not.toContain(HOME);
  });

  it("mise: missionkit binary gets the @missionkit/cli entry", () => {
    const result = assessNodeManager({
      binPath: `${HOME}/.local/share/mise/installs/node/26.8.2/bin/missionkit`,
      binRealPath: null,
      nodeExecPath: null,
      platform: "linux",
      homeDir: HOME,
    });
    expect(result.fix).toBe(miseToolEntry("@missionkit/cli"));
  });

  it("nvm: reinstall-packages-from the old version, plus the fixed-prefix alternative", () => {
    const result = assessNodeManager({
      binPath: `${HOME}/.nvm/versions/node/v22.12.0/bin/agent-kit`,
      binRealPath: `${HOME}/.nvm/versions/node/v22.12.0/lib/node_modules/@dadado/agent-kit-cli/dist/index.js`,
      nodeExecPath: `${HOME}/.nvm/versions/node/v24.1.0/bin/node`,
      platform: "linux",
      homeDir: HOME,
    });
    expect(result.severity).toBe("warning");
    expect(result.fix).toBe("nvm install v24.1.0 --reinstall-packages-from=v22.12.0");
    expect(result.fixKind).toBe("command");
    expect(result.detail).toContain("npm i -g --prefix ~/.local @dadado/agent-kit-cli");
  });

  it("nvm: same version as the running node -> <new> placeholder", () => {
    const result = assessNodeManager({
      binPath: `${HOME}/.nvm/versions/node/v22.12.0/bin/agent-kit`,
      binRealPath: null,
      nodeExecPath: `${HOME}/.nvm/versions/node/v22.12.0/bin/node`,
      platform: "linux",
      homeDir: HOME,
    });
    expect(result.fix).toBe("nvm install <new> --reinstall-packages-from=v22.12.0");
    // A placeholder is not a runnable command: never offered as a terminal copy.
    expect(result.fixKind).toBe("template");
    expect(result.detail).not.toContain("orphaned");
  });

  it("fnm: the PATH entry is a multishell symlink; the realpath shows the version", () => {
    const result = assessNodeManager({
      binPath: `${HOME}/.local/state/fnm_multishells/1234_1700000000000/bin/agent-kit`,
      binRealPath: `${HOME}/.local/share/fnm/node-versions/v22.12.0/installation/lib/node_modules/@dadado/agent-kit-cli/dist/index.js`,
      nodeExecPath: null,
      platform: "linux",
      homeDir: HOME,
    });
    expect(result.severity).toBe("warning");
    expect(result.fix).toBe("fnm use <new> && npm i -g @dadado/agent-kit-cli");
    expect(result.fixKind).toBe("template");
  });

  it("nvm-windows: the NVM_SYMLINK junction resolves into %NVM_HOME%", () => {
    const result = assessNodeManager({
      binPath: "C:\\Program Files\\nodejs\\agent-kit.cmd",
      binRealPath: "C:\\Users\\op\\AppData\\Roaming\\nvm\\v22.12.0\\agent-kit.cmd",
      nodeExecPath: "C:\\Users\\op\\AppData\\Roaming\\nvm\\v24.1.0\\node.exe",
      platform: "win32",
      homeDir: "C:\\Users\\op",
    });
    expect(result.severity).toBe("warning");
    expect(result.fix).toBe("nvm use v24.1.0 && npm i -g @dadado/agent-kit-cli");
  });

  it.each([
    [`${HOME}/.volta/bin/agent-kit`, "Volta"],
    ["/opt/homebrew/bin/agent-kit", "Homebrew node"],
    ["/usr/bin/agent-kit", "a node install that keeps globals"],
    [`${HOME}/.local/share/mise/shims/agent-kit`, "a mise shim"],
  ])("%s is not flagged", (binPath, kind) => {
    const result = assessNodeManager({
      binPath,
      binRealPath: null,
      nodeExecPath: null,
      platform: binPath.startsWith("/opt") ? "darwin" : "linux",
      homeDir: HOME,
    });
    expect(result.severity).toBe("ok");
    expect(result.fix).toBeNull();
    expect(result.detail).toContain(kind);
  });

  it("no CLI on PATH is ok", () => {
    expect(
      assessNodeManager({
        binPath: null,
        binRealPath: null,
        nodeExecPath: null,
        platform: "linux",
        homeDir: HOME,
      }).severity,
    ).toBe("ok");
  });
});

describe("assessGlobalCli", () => {
  const base = {
    binPath: `${HOME}/.npm-global/bin/agent-kit`,
    binVersion: "6.19.1",
    latestChecked: true,
    homeDir: HOME,
  };

  it("behind npm latest: warning with the package that answered", () => {
    const result = assessGlobalCli({
      ...base,
      latest: { packageName: "@dadado/agent-kit-cli", version: "6.22.0" },
    });
    expect(result.severity).toBe("warning");
    expect(result.detail).toContain("v6.19.1 at ~/.npm-global/bin/agent-kit");
    expect(result.fix).toBe("npm i -g @dadado/agent-kit-cli@6.22.0");
  });

  it("the renamed package can be the newest", () => {
    const result = assessGlobalCli({
      ...base,
      latest: { packageName: "@missionkit/cli", version: "7.0.0" },
    });
    expect(result.fix).toBe("npm i -g @missionkit/cli@7.0.0");
  });

  it("current or ahead is ok", () => {
    expect(
      assessGlobalCli({
        ...base,
        latest: { packageName: "@dadado/agent-kit-cli", version: "6.19.1" },
      }).severity,
    ).toBe("ok");
    expect(
      assessGlobalCli({
        ...base,
        latest: { packageName: "@dadado/agent-kit-cli", version: "6.0.0" },
      }).detail,
    ).toContain("ahead");
  });

  it("npm unreachable or not checked fails open as info", () => {
    const offline = assessGlobalCli({ ...base, latest: null });
    expect(offline.severity).toBe("info");
    expect(offline.detail).toContain("did not answer");
    const skipped = assessGlobalCli({ ...base, latestChecked: false, latest: null });
    expect(skipped.severity).toBe("info");
    expect(skipped.detail).toContain("not checked");
  });

  it("no binary on PATH is info, naming both binaries", () => {
    const result = assessGlobalCli({ ...base, binPath: null, binVersion: null, latest: null });
    expect(result.severity).toBe("info");
    expect(result.detail).toContain("agent-kit or missionkit");
    expect(result.fix).toBeNull();
  });
});

describe("assessHomeInstall", () => {
  const base = {
    homeDir: HOME,
    cwd: `${HOME}/code/app`,
    presentRels: [".cursor/agent-kit.json", ".cursor/rules", ".cursor/hooks.json"],
    repoVersion: "6.22.0",
    cliVersion: "6.22.0",
  };

  it("older home install: warning naming the paths, nothing moved", () => {
    const result = assessHomeInstall({ ...base, homeManifestVersion: "3.0.0" });
    expect(result.severity).toBe("warning");
    expect(result.detail).toContain("v3.0.0 is older than this repo's kit v6.22.0");
    expect(result.detail).toContain(
      "~/.cursor/agent-kit.json, ~/.cursor/rules/, ~/.cursor/hooks.json",
    );
    expect(result.detail).toContain("Nothing was moved");
    // Naming the paths is the whole remedy: no one-click rewrite of ~/.cursor.
    expect(result.fix).toBeNull();
  });

  it("no home manifest, current home install, or cwd is home: ok", () => {
    expect(assessHomeInstall({ ...base, homeManifestVersion: null }).severity).toBe("ok");
    expect(assessHomeInstall({ ...base, homeManifestVersion: "6.22.0" }).severity).toBe("ok");
    expect(assessHomeInstall({ ...base, cwd: HOME, homeManifestVersion: "3.0.0" }).severity).toBe(
      "ok",
    );
  });

  it("repo without a kit compares against the running CLI", () => {
    const result = assessHomeInstall({ ...base, repoVersion: null, homeManifestVersion: "6.0.0" });
    expect(result.detail).toContain("the running CLI v6.22.0");
  });
});

describe("assessRegistryPin", () => {
  const base = {
    hasManifest: true,
    installedVersion: "5.9.0",
    registryUrl: "https://github.com/agent-kit-startup/agent-kit.git",
    cliVersion: "5.9.0",
  };

  it("semver pin older than the CLI: warning with update --ref", () => {
    const result = assessRegistryPin({ ...base, registryRef: "v5.4.0" });
    expect(result.severity).toBe("warning");
    expect(result.fix).toBe("agent-kit update --ref v5.9.0");
  });

  it.each([
    ["v5.9.0", "current"],
    ["main", "branch"],
    [null, "No registry.ref"],
  ])("%s is ok", (ref, word) => {
    const result = assessRegistryPin({ ...base, registryRef: ref });
    expect(result.severity).toBe("ok");
    expect(result.detail).toContain(word);
  });

  it("factory registry and missing manifest are ok", () => {
    expect(
      assessRegistryPin({
        ...base,
        registryUrl: "https://github.com/agent-kit-startup/agent-kit-dev.git",
        registryRef: "v1.0.0",
      }).severity,
    ).toBe("ok");
    expect(
      assessRegistryPin({ ...base, hasManifest: false, installedVersion: null, registryRef: null })
        .severity,
    ).toBe("ok");
  });
});

describe("assessInstallHealth (gatherer with injected fs)", () => {
  it("home install fixture + mise path fixture -> warning report, no real fs", async () => {
    const files: Record<string, string> = {
      [`${HOME}/.cursor/agent-kit.json`]: JSON.stringify({ version: "3.0.0" }),
    };
    const existing = new Set([`${HOME}/.cursor/agent-kit.json`, `${HOME}/.cursor/hooks.json`]);
    const readFileImpl = vi.fn(async (p: string) => {
      const body = files[p];
      if (body === undefined) throw new Error(`ENOENT ${p}`);
      return body;
    });
    const report = await assessInstallHealth({
      cwd: `${HOME}/code/app`,
      cliVersion: "6.22.1",
      npm: { checked: true, latest: { packageName: "@dadado/agent-kit-cli", version: "6.22.1" } },
      binPath: `${HOME}/.local/share/mise/installs/node/26.8.2/bin/agent-kit`,
      binVersion: "6.16.1",
      manifest: { version: "6.22.0", registryUrl: null, registryRef: "v6.20.0" },
      platform: "linux",
      homeDir: HOME,
      nodeExecPath: `${HOME}/.local/share/mise/installs/node/26.13.1/bin/node`,
      realpathImpl: async (p) => p,
      readFileImpl,
      existsImpl: async (p) => existing.has(p),
    });
    const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(report.status).toBe("warning");
    expect(report.checks.map((c) => c.id)).toEqual([
      "global-cli",
      "node-manager",
      "home-install",
      "registry-pin",
    ]);
    expect(by["global-cli"]?.severity).toBe("warning");
    // Reinstalling into the same node dir would vanish again: defer to node-manager.
    expect(by["global-cli"]?.fix).toBeNull();
    expect(by["global-cli"]?.detail).toContain("use the Node version manager fix");
    expect(by["node-manager"]?.fix).toBe(miseToolEntry("@dadado/agent-kit-cli"));
    expect(by["home-install"]?.detail).toContain("~/.cursor/agent-kit.json, ~/.cursor/hooks.json");
    expect(by["registry-pin"]?.fix).toBe("agent-kit update --ref v6.22.1");
    expect(JSON.stringify(report)).not.toContain(`${HOME}/`);
  });

  it("clean machine -> ok", async () => {
    const report = await assessInstallHealth({
      cwd: `${HOME}/code/app`,
      cliVersion: "6.22.1",
      npm: { checked: false, latest: null },
      binPath: "/usr/local/bin/agent-kit",
      binVersion: "6.22.1",
      manifest: { version: "6.22.1", registryUrl: null, registryRef: "main" },
      platform: "linux",
      homeDir: HOME,
      nodeExecPath: "/usr/bin/node",
      realpathImpl: async (p) => p,
      readFileImpl: async () => {
        throw new Error("ENOENT");
      },
      existsImpl: async () => false,
    });
    expect(report.status).toBe("ok");
  });
});

describe("helpers", () => {
  it("npmLatestCheckAllowed: off under CI and with explicit updateCheck.enabled false only", () => {
    expect(npmLatestCheckAllowed({}, null)).toBe(true);
    expect(npmLatestCheckAllowed({}, { updateCheck: {} })).toBe(true);
    expect(npmLatestCheckAllowed({ CI: "true" }, null)).toBe(false);
    expect(npmLatestCheckAllowed({ CI: "false" }, null)).toBe(true);
    expect(npmLatestCheckAllowed({}, { updateCheck: { enabled: false } })).toBe(false);
  });

  it("packageForBin maps both binaries", () => {
    expect(packageForBin("agent-kit")).toBe("@dadado/agent-kit-cli");
    expect(packageForBin("missionkit.cmd")).toBe("@missionkit/cli");
  });

  it("homeRelative handles both separators", () => {
    expect(homeRelative("/home/op/x", "/home/op")).toBe("~/x");
    expect(homeRelative("C:\\Users\\op\\x", "C:\\Users\\op")).toBe("~/x");
    expect(homeRelative("/usr/bin/x", "/home/op")).toBe("/usr/bin/x");
  });
});
