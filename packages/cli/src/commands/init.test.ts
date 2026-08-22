import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentReport } from "../readiness/env-checks.js";
import { RootRefusedError } from "../utils/terminal.js";
import { initCommand } from "./init.js";

const mockConfirmProjectRoot = vi.hoisted(() => vi.fn());
const mockPerformInstall = vi.hoisted(() => vi.fn());
const mockAssessEnvironment = vi.hoisted(() => vi.fn());

vi.mock("../utils/terminal.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../utils/terminal.js")>();
  return {
    ...mod,
    confirmProjectRoot: (...args: unknown[]) => mockConfirmProjectRoot(...args),
    isNonInteractive: () => true,
  };
});

vi.mock("../readiness/env-checks.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../readiness/env-checks.js")>();
  return {
    ...mod,
    assessEnvironment: (...args: unknown[]) => mockAssessEnvironment(...args),
  };
});

vi.mock("./install.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./install.js")>();
  return {
    ...mod,
    performInstall: (...args: unknown[]) => mockPerformInstall(...args),
  };
});

function makeEnvReport(overrides: Partial<EnvironmentReport> = {}): EnvironmentReport {
  return {
    binOnPath: false,
    npmPrefixWritable: true,
    npmPrefix: { prefix: "/usr/local", writable: true, source: "heuristic" },
    nodeVersionOk: true,
    nodeVersion: "v20.11.0",
    shell: "zsh",
    shellProfile: "/home/user/.zshrc",
    ...overrides,
  };
}

type RunCtx = { args: Record<string, unknown> };
const runInit = (cwd: string, forceRoot = false) =>
  (initCommand.run as unknown as (ctx: RunCtx) => Promise<void>)({
    args: { _: [], cwd, yes: true, "force-root": forceRoot },
  });

describe("initCommand project-root guard", () => {
  beforeEach(() => {
    mockAssessEnvironment.mockResolvedValue(makeEnvReport());
  });

  afterEach(() => {
    mockConfirmProjectRoot.mockReset();
    mockPerformInstall.mockReset();
    mockAssessEnvironment.mockReset();
    process.exitCode = undefined;
  });

  it("refuses without installing when the root guard rejects the directory", async () => {
    mockConfirmProjectRoot.mockRejectedValue(
      new RootRefusedError("/tmp/blank", "Refused /tmp/blank: no .git", "git init"),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await runInit("/tmp/blank");
      // The whole point: `init` used to call performInstall unconditionally,
      // so a blank no-git folder got L0 written into it with no confirmation.
      expect(mockPerformInstall).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("installs into the confirmed root, not the raw cwd argument", async () => {
    mockConfirmProjectRoot.mockResolvedValue("/tmp/confirmed-project");
    mockPerformInstall.mockResolvedValue({
      projectRoot: "/tmp/confirmed-project",
      manifestPath: "/tmp/confirmed-project/.cursor/agent-kit.json",
      stats: {},
      readiness: { pendingActions: [] },
      safeChanges: [],
    });

    await runInit("/tmp/confirmed-project");
    expect(mockPerformInstall).toHaveBeenCalledWith({ cwd: "/tmp/confirmed-project" });
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the smart epilogue (not a bare `agent-kit` next step) after a successful install", async () => {
    mockConfirmProjectRoot.mockResolvedValue("/tmp/confirmed-project");
    mockPerformInstall.mockResolvedValue({
      projectRoot: "/tmp/confirmed-project",
      manifestPath: "/tmp/confirmed-project/.cursor/agent-kit.json",
      stats: {},
      readiness: { pendingActions: [] },
      safeChanges: [],
    });
    mockAssessEnvironment.mockResolvedValue(makeEnvReport({ binOnPath: false }));
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runInit("/tmp/confirmed-project");
      expect(mockAssessEnvironment).toHaveBeenCalled();
      const printed = consoleLogSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("npx @dadado/agent-kit-cli setup-global");
      // The "keep using npx" option must recommend npx, never a bare bin.
      expect(printed).toContain("1. Keep using npx");
      expect(printed).toContain("npx @dadado/agent-kit-cli <subcommand>");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("passes --force-root through to the guard", async () => {
    mockConfirmProjectRoot.mockResolvedValue("/tmp/forced");
    mockPerformInstall.mockResolvedValue({
      projectRoot: "/tmp/forced",
      manifestPath: "/tmp/forced/.cursor/agent-kit.json",
      stats: {},
      readiness: { pendingActions: [] },
      safeChanges: [],
    });

    await runInit("/tmp/forced", true);
    expect(mockConfirmProjectRoot).toHaveBeenCalledWith(
      "/tmp/forced",
      expect.objectContaining({ forceRoot: true, nonInteractive: true }),
    );
  });
});
