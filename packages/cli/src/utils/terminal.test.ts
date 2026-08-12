import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RootRefusedError,
  classifyInstallError,
  confirmProjectRoot,
  isNonInteractive,
  validateProjectRoot,
} from "./terminal.js";

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
