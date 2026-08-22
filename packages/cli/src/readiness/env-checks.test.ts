import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assessEnvironment,
  checkBinOnPath,
  checkNpmPrefixWritable,
  detectNpmPrefix,
  detectShellName,
  detectShellProfile,
  heuristicPrefixFromExecPath,
  isNodeVersionOk,
  parseNpmrcPrefix,
} from "./env-checks.js";

describe("isNodeVersionOk", () => {
  it("accepts versions at or above the minimum major", () => {
    expect(isNodeVersionOk("v20.0.0")).toBe(true);
    expect(isNodeVersionOk("v20.11.1")).toBe(true);
    expect(isNodeVersionOk("v22.4.0")).toBe(true);
    expect(isNodeVersionOk("22.4.0")).toBe(true);
  });

  it("rejects versions below the minimum major", () => {
    expect(isNodeVersionOk("v19.9.9")).toBe(false);
    expect(isNodeVersionOk("v18.20.0")).toBe(false);
  });

  it("respects a custom minimum major", () => {
    expect(isNodeVersionOk("v18.20.0", 18)).toBe(true);
    expect(isNodeVersionOk("v16.0.0", 18)).toBe(false);
  });

  it("returns false for unparsable version strings", () => {
    expect(isNodeVersionOk("not-a-version")).toBe(false);
    expect(isNodeVersionOk("")).toBe(false);
  });
});

describe("detectShellName", () => {
  it("detects zsh and bash from $SHELL", () => {
    expect(detectShellName({ SHELL: "/bin/zsh" }, "darwin")).toBe("zsh");
    expect(detectShellName({ SHELL: "/usr/bin/bash" }, "linux")).toBe("bash");
  });

  it("reports other shells by name instead of null", () => {
    expect(detectShellName({ SHELL: "/usr/bin/fish" }, "linux")).toBe("fish");
  });

  it("returns null when $SHELL is unset", () => {
    expect(detectShellName({}, "linux")).toBeNull();
  });

  it("falls back to powershell/cmd markers on win32 and null otherwise", () => {
    expect(detectShellName({ PSModulePath: "C:\\ps" }, "win32")).toBe("powershell");
    expect(detectShellName({ ComSpec: "C:\\cmd.exe" }, "win32")).toBe("cmd");
    expect(detectShellName({}, "win32")).toBeNull();
  });
});

describe("detectShellProfile", () => {
  const home = "/home/carlos";

  it("maps zsh to ~/.zshrc", () => {
    expect(detectShellProfile({ SHELL: "/bin/zsh" }, "darwin", home)).toBe(
      path.join(home, ".zshrc"),
    );
  });

  it("maps bash to ~/.bashrc", () => {
    expect(detectShellProfile({ SHELL: "/bin/bash" }, "linux", home)).toBe(
      path.join(home, ".bashrc"),
    );
  });

  it("returns null for other shells", () => {
    expect(detectShellProfile({ SHELL: "/usr/bin/fish" }, "linux", home)).toBeNull();
  });

  it("returns null when $SHELL is unset", () => {
    expect(detectShellProfile({}, "linux", home)).toBeNull();
  });
});

describe("checkBinOnPath", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true when the bin exists and is executable on a PATH dir (posix)", async () => {
    if (process.platform === "win32") return; // exec bit semantics differ; covered via win32 case below
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-envcheck-"));
    const binPath = path.join(tmpDir, "agent-kit");
    await import("node:fs/promises").then(({ writeFile, chmod }) =>
      writeFile(binPath, "#!/bin/sh\necho hi\n").then(() => chmod(binPath, 0o755)),
    );
    const found = await checkBinOnPath("agent-kit", { PATH: tmpDir }, "linux");
    expect(found).toBe(true);
  });

  it("returns false when no PATH dir contains the bin", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-envcheck-"));
    await mkdir(path.join(tmpDir, "empty"), { recursive: true });
    const found = await checkBinOnPath("agent-kit", { PATH: path.join(tmpDir, "empty") }, "linux");
    expect(found).toBe(false);
  });

  it("returns false without throwing when PATH is unset", async () => {
    await expect(checkBinOnPath("agent-kit", {}, "linux")).resolves.toBe(false);
  });

  it("checks .cmd/.exe suffixes on win32", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-envcheck-"));
    const binPath = path.join(tmpDir, "agent-kit.cmd");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(binPath, "@echo off\n"));
    const found = await checkBinOnPath("agent-kit", { PATH: tmpDir }, "win32");
    expect(found).toBe(true);
  });
});

describe("parseNpmrcPrefix", () => {
  it("extracts a prefix line", () => {
    expect(parseNpmrcPrefix("prefix=/home/carlos/.npm-global\n", "/home/carlos")).toBe(
      "/home/carlos/.npm-global",
    );
  });

  it("expands a leading ~ against homeDir", () => {
    expect(parseNpmrcPrefix("prefix = ~/.npm-global\n", "/home/carlos")).toBe(
      path.join("/home/carlos", ".npm-global"),
    );
  });

  it("strips surrounding quotes", () => {
    expect(parseNpmrcPrefix('prefix="/opt/npm-global"\n', "/home/carlos")).toBe("/opt/npm-global");
  });

  it("returns null when there is no prefix line", () => {
    expect(parseNpmrcPrefix("registry=https://registry.npmjs.org/\n", "/home/carlos")).toBeNull();
  });
});

describe("heuristicPrefixFromExecPath", () => {
  it("strips /bin/node on posix", () => {
    expect(heuristicPrefixFromExecPath("/usr/local/bin/node", "linux")).toBe("/usr/local");
  });

  it("uses the node.exe directory on win32", () => {
    expect(heuristicPrefixFromExecPath("C:\\nodejs\\node.exe", "win32")).toBe("C:\\nodejs");
  });
});

describe("detectNpmPrefix", () => {
  it("prefers an explicit env override", async () => {
    const result = await detectNpmPrefix({
      env: { npm_config_prefix: "/custom/prefix" },
      platform: "linux",
      homeDir: "/home/carlos",
      execPath: "/usr/local/bin/node",
    });
    expect(result).toEqual({ prefix: "/custom/prefix", source: "env" });
  });

  it("falls back to a .npmrc prefix line via the injected reader", async () => {
    const result = await detectNpmPrefix({
      env: {},
      platform: "linux",
      homeDir: "/home/carlos",
      execPath: "/usr/local/bin/node",
      readFileImpl: async () => "prefix=/home/carlos/.npm-global\n",
    });
    expect(result).toEqual({ prefix: "/home/carlos/.npm-global", source: "npmrc" });
  });

  it("falls back to the execPath heuristic when no .npmrc is found", async () => {
    const result = await detectNpmPrefix({
      env: {},
      platform: "linux",
      homeDir: "/home/carlos",
      execPath: "/usr/local/bin/node",
      readFileImpl: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result).toEqual({ prefix: "/usr/local", source: "heuristic" });
  });
});

describe("checkNpmPrefixWritable", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports writable:true for a writable directory", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-envcheck-prefix-"));
    const report = await checkNpmPrefixWritable({
      env: { npm_config_prefix: tmpDir },
      platform: "linux",
    });
    expect(report).toMatchObject({ prefix: tmpDir, writable: true, source: "env" });
  });

  it("resolves quickly without spawning any subprocess", async () => {
    const started = Date.now();
    await checkNpmPrefixWritable({
      env: { npm_config_prefix: "/nonexistent/prefix" },
      platform: "linux",
    });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("assessEnvironment", () => {
  it("never throws and produces the exact doctor --json shape", async () => {
    const report = await assessEnvironment({
      env: { PATH: "", SHELL: "/bin/zsh" },
      platform: "linux",
      nodeVersion: "v20.11.0",
      homeDir: "/home/carlos",
      binName: "agent-kit",
    });

    expect(report).toMatchObject({
      binOnPath: false,
      nodeVersionOk: true,
      shellProfile: path.join("/home/carlos", ".zshrc"),
    });
    expect(typeof report.npmPrefixWritable).toBe("boolean");
    // JSON-serializable: no functions/undefined leaking through.
    expect(() => JSON.stringify(report)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(report));
    expect(parsed).toHaveProperty("binOnPath");
    expect(parsed).toHaveProperty("npmPrefixWritable");
    expect(parsed).toHaveProperty("nodeVersionOk");
    expect(parsed).toHaveProperty("shellProfile");
  });

  it("flags old node versions as not ok", async () => {
    const report = await assessEnvironment({
      env: {},
      platform: "linux",
      nodeVersion: "v18.19.0",
      homeDir: "/home/carlos",
    });
    expect(report.nodeVersionOk).toBe(false);
  });
});
