import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NESTED_REPO_AMBIGUITY_THRESHOLD,
  RootRefusedError,
  classifyInstallError,
  confirmProjectRoot,
  findNestedRepoChildren,
  isNonInteractive,
  validateProjectRoot,
} from "./terminal.js";

/** A directory with its own `.git` plus `count` immediate child repositories. */
async function makeParentOfRepos(count: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "ak-parent-"));
  await mkdir(path.join(dir, ".git"), { recursive: true });
  for (let i = 0; i < count; i += 1) {
    await mkdir(path.join(dir, `repo-${i}`, ".git"), { recursive: true });
  }
  return dir;
}

describe("isNonInteractive", () => {
  const originalIsTTY = process.stdin.isTTY;

  function setStdinIsTTY(value: boolean | undefined): void {
    Object.defineProperty(process.stdin, "isTTY", {
      value,
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    setStdinIsTTY(originalIsTTY);
  });

  it("returns true when CI=true", () => {
    vi.stubEnv("CI", "true");
    setStdinIsTTY(true);
    expect(isNonInteractive()).toBe(true);
  });

  it("returns true when CI=1", () => {
    vi.stubEnv("CI", "1");
    setStdinIsTTY(true);
    expect(isNonInteractive()).toBe(true);
  });

  it("returns true when AGENT_KIT_YES=1", () => {
    vi.stubEnv("AGENT_KIT_YES", "1");
    setStdinIsTTY(true);
    expect(isNonInteractive()).toBe(true);
  });

  it("returns true when stdin is not a TTY", () => {
    vi.stubEnv("CI", undefined);
    vi.stubEnv("AGENT_KIT_YES", undefined);
    setStdinIsTTY(undefined);
    expect(isNonInteractive()).toBe(true);
  });

  it("returns false in an interactive TTY without env flags", () => {
    vi.stubEnv("CI", undefined);
    vi.stubEnv("AGENT_KIT_YES", undefined);
    setStdinIsTTY(true);
    expect(isNonInteractive()).toBe(false);
  });
});

describe("classifyInstallError", () => {
  const npmGlobalEaccesCases: Array<[string, string]> = [
    [
      "macOS mkdir on scoped package dir",
      "EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@dadado'",
    ],
    [
      "macOS access on prefix root",
      "EACCES: permission denied, access '/usr/local/lib/node_modules'",
    ],
    [
      "Linux mkdir under /usr/lib/node_modules",
      "EACCES: permission denied, mkdir '/usr/lib/node_modules/@dadado'",
    ],
    [
      "open on package-lock.json inside global prefix",
      "Error: EACCES: permission denied, open '/usr/local/lib/node_modules/.package-lock.json'",
    ],
  ];

  it.each(npmGlobalEaccesCases)("classifies npm global EACCES errors: %s", (_label, message) => {
    const err = Object.assign(new Error(message), { code: "EACCES" });
    const hint = classifyInstallError(err);
    expect(hint.kind).toBe("npm-global-eacces");
    expect(hint.message).toContain("root-owned npm prefix");
    expect(hint.recovery).toContain("setup-global");
  });

  it("classifies npm global EACCES errors by message alone (no .code set)", () => {
    const hint = classifyInstallError(
      new Error("EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@dadado'"),
    );
    expect(hint.kind).toBe("npm-global-eacces");
    expect(hint.recovery).toContain("setup-global");
  });

  it("does not misclassify a generic EACCES error unrelated to node_modules", () => {
    const err = Object.assign(
      new Error("EACCES: permission denied, open '/Users/dev/.config/some-tool/config.json'"),
      { code: "EACCES" },
    );
    const hint = classifyInstallError(err);
    expect(hint.kind).toBe("eperm");
    expect(hint.recovery).toContain("ownership drift");
  });

  it("classifies EPERM errors", () => {
    const err = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    const hint = classifyInstallError(err);
    expect(hint.kind).toBe("eperm");
    expect(hint.recovery).toContain("npm cache");
    expect(hint.recovery).toContain("Port B");
  });

  it("classifies EACCES errors", () => {
    const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const hint = classifyInstallError(err);
    expect(hint.kind).toBe("eperm");
    expect(hint.recovery).toContain("ownership drift");
  });

  it("classifies 403 Forbidden errors", () => {
    const hint = classifyInstallError(
      new Error("403 Forbidden - GET https://registry.npmjs.org/@dadado/agent-kit-cli"),
    );
    expect(hint.kind).toBe("registry-auth");
    expect(hint.recovery).toContain("npm whoami");
  });

  it("classifies E401 / ENEEDAUTH errors", () => {
    const hint = classifyInstallError(new Error("ENEEDAUTH"));
    expect(hint.kind).toBe("registry-auth");
  });

  it("classifies network errors by code", () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND registry.npmjs.org"), {
      code: "ENOTFOUND",
    });
    const hint = classifyInstallError(err);
    expect(hint.kind).toBe("network");
    expect(hint.recovery).toContain("network/proxy");
  });

  it("classifies timeout errors", () => {
    const err = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    const hint = classifyInstallError(err);
    expect(hint.kind).toBe("network");
  });

  it("returns unknown for unrecognized errors", () => {
    const hint = classifyInstallError(new Error("something unexpected"));
    expect(hint.kind).toBe("unknown");
    expect(hint.message).toContain("something unexpected");
  });

  it("handles non-Error values", () => {
    const hint = classifyInstallError("string error");
    expect(hint.kind).toBe("unknown");
    expect(hint.message).toBe("string error");
  });
});

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: vi.fn((v: unknown) => v === Symbol.for("cancel")),
}));

describe("validateProjectRoot", () => {
  it("refuses the filesystem root", async () => {
    const result = await validateProjectRoot("/");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("/");
  });

  it("refuses the user's home directory", async () => {
    const result = await validateProjectRoot(homedir());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(homedir());
  });

  it("refuses a directory with neither .git nor .cursor/agent-kit.json", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    const result = await validateProjectRoot(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no .git");
  });

  it("names all three sanctioned start-from-zero paths on an empty folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    const result = await validateProjectRoot(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.recovery).toContain("git init");
      expect(result.recovery).toContain("--force-root");
      expect(result.recovery).toContain("Proceed anyway?");
      // The Git pillar itself stays owned by /agent-kit-onboard.
      expect(result.recovery).toContain("/agent-kit-onboard");
    }
  });

  it("accepts a directory with a .git folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await expect(validateProjectRoot(dir)).resolves.toEqual({ ok: true });
  });

  it("accepts a directory with an existing manifest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await mkdir(path.join(dir, ".cursor"), { recursive: true });
    await writeFile(path.join(dir, ".cursor", "agent-kit.json"), "{}", "utf8");
    await expect(validateProjectRoot(dir)).resolves.toEqual({ ok: true });
  });

  it("accepts a .git root with a single nested child repo (vendored/submodule shape)", async () => {
    const dir = await makeParentOfRepos(1);
    await expect(validateProjectRoot(dir)).resolves.toEqual({ ok: true });
  });

  it("accepts a .git root whose many children are not repositories (monorepo shape)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await mkdir(path.join(dir, ".git"), { recursive: true });
    for (const name of ["apps", "packages", "docs", "scripts", "tools"]) {
      await mkdir(path.join(dir, name), { recursive: true });
    }
    await expect(validateProjectRoot(dir)).resolves.toEqual({ ok: true });
  });

  it("refuses a .git root that is a parent of two or more child repositories", async () => {
    const dir = await makeParentOfRepos(2);
    const result = await validateProjectRoot(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("parent-of-repos");
      expect(result.reason).toContain("repo-0");
      expect(result.reason).toContain("repo-1");
      expect(result.recovery).toContain("--force-root");
      expect(result.recovery).toContain("cd into the project you meant");
    }
  });

  it("does not re-flag an already-installed root as a parent-of-repos", async () => {
    const dir = await makeParentOfRepos(3);
    await mkdir(path.join(dir, ".cursor"), { recursive: true });
    await writeFile(path.join(dir, ".cursor", "agent-kit.json"), "{}", "utf8");
    await expect(validateProjectRoot(dir)).resolves.toEqual({ ok: true });
  });

  it("ignores dot-directories and node_modules when counting nested repos", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await mkdir(path.join(dir, ".git"), { recursive: true });
    for (const name of [".hidden", "node_modules", "vendor"]) {
      await mkdir(path.join(dir, name, ".git"), { recursive: true });
    }
    await expect(validateProjectRoot(dir)).resolves.toEqual({ ok: true });
  });
});

describe("findNestedRepoChildren", () => {
  it("stops counting at the ambiguity threshold", async () => {
    const dir = await makeParentOfRepos(5);
    const nested = await findNestedRepoChildren(dir);
    expect(nested).toHaveLength(NESTED_REPO_AMBIGUITY_THRESHOLD);
  });

  it("returns an empty list for an unreadable path instead of throwing", async () => {
    await expect(
      findNestedRepoChildren(path.join(tmpdir(), "ak-does-not-exist-", String(Date.now()))),
    ).resolves.toEqual([]);
  });
});

describe("confirmProjectRoot", () => {
  let validProject: string;

  beforeEach(async () => {
    validProject = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await mkdir(path.join(validProject, ".git"), { recursive: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns resolved path in non-interactive mode for a valid directory", async () => {
    const result = await confirmProjectRoot(validProject, {
      nonInteractive: true,
      command: "install",
    });
    expect(result).toBe(path.resolve(validProject));
  });

  it("refuses ambiguous root in non-interactive mode (--yes / CI)", async () => {
    const badDir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await expect(
      confirmProjectRoot(badDir, { nonInteractive: true, command: "install" }),
    ).rejects.toThrow(RootRefusedError);
  });

  it("carries the start-from-zero recovery block on the refusal error", async () => {
    const badDir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    const err = await confirmProjectRoot(badDir, {
      nonInteractive: true,
      command: "install",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootRefusedError);
    expect((err as RootRefusedError).recovery).toContain("git init");
  });

  it("refuses a parent-of-repos root in non-interactive mode", async () => {
    const parent = await makeParentOfRepos(2);
    await expect(
      confirmProjectRoot(parent, { nonInteractive: true, command: "install" }),
    ).rejects.toThrow(RootRefusedError);
  });

  it("still installs into a parent-of-repos root when the user proceeds interactively", async () => {
    const { confirm } = await import("@clack/prompts");
    vi.mocked(confirm).mockResolvedValueOnce(true);
    const parent = await makeParentOfRepos(2);
    await expect(
      confirmProjectRoot(parent, { nonInteractive: false, command: "install" }),
    ).resolves.toBe(path.resolve(parent));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ initialValue: false }));
  });

  it("bypasses the parent-of-repos guard with forceRoot", async () => {
    const parent = await makeParentOfRepos(3);
    await expect(
      confirmProjectRoot(parent, { nonInteractive: true, command: "install", forceRoot: true }),
    ).resolves.toBe(path.resolve(parent));
  });

  it("refuses home directory in non-interactive mode", async () => {
    await expect(
      confirmProjectRoot(homedir(), { nonInteractive: true, command: "install" }),
    ).rejects.toThrow(RootRefusedError);
  });

  it("bypasses validation when forceRoot is true", async () => {
    const badDir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    const result = await confirmProjectRoot(badDir, {
      nonInteractive: true,
      command: "install",
      forceRoot: true,
    });
    expect(result).toBe(path.resolve(badDir));
  });

  it("returns resolved path when user confirms in interactive mode", async () => {
    const { confirm } = await import("@clack/prompts");
    vi.mocked(confirm).mockResolvedValueOnce(true);
    const result = await confirmProjectRoot(validProject, {
      nonInteractive: false,
      command: "install",
    });
    expect(result).toBe(path.resolve(validProject));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(validProject) }),
    );
  });

  it("accepts an empty no-git folder when the user proceeds interactively", async () => {
    const { confirm } = await import("@clack/prompts");
    vi.mocked(confirm).mockResolvedValueOnce(true);
    const blank = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await expect(
      confirmProjectRoot(blank, { nonInteractive: false, command: "install" }),
    ).resolves.toBe(path.resolve(blank));
    // Only the warn prompt runs; the normal "Install Agent Kit in:" confirm
    // is not asked a second time.
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("warns and defaults to refusing an ambiguous directory in interactive mode", async () => {
    const { confirm } = await import("@clack/prompts");
    vi.mocked(confirm).mockResolvedValueOnce(false);
    const badDir = await mkdtemp(path.join(tmpdir(), "ak-root-"));
    await expect(
      confirmProjectRoot(badDir, { nonInteractive: false, command: "update" }),
    ).rejects.toThrow(RootRefusedError);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ initialValue: false }));
  });

  it("throws RootRefusedError when user declines", async () => {
    const { confirm } = await import("@clack/prompts");
    vi.mocked(confirm).mockResolvedValueOnce(false);
    await expect(
      confirmProjectRoot(validProject, { nonInteractive: false, command: "update" }),
    ).rejects.toThrow(RootRefusedError);
  });

  it("throws RootRefusedError on cancel", async () => {
    const { confirm, isCancel } = await import("@clack/prompts");
    const cancelSymbol = Symbol.for("cancel");
    vi.mocked(confirm).mockResolvedValueOnce(cancelSymbol as unknown as boolean);
    vi.mocked(isCancel).mockReturnValueOnce(true);
    await expect(
      confirmProjectRoot(validProject, { nonInteractive: false, command: "install" }),
    ).rejects.toThrow(RootRefusedError);
  });
});
