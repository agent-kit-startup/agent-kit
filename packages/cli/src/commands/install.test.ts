import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentReport } from "../readiness/env-checks.js";
import { RootRefusedError } from "../utils/terminal.js";
import { installCommand, nextStepAfterInstall, printInstallEpilogue } from "./install.js";

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

const mockConfirmProjectRoot = vi.hoisted(() => vi.fn());
const mockResolveRegistryFromCli = vi.hoisted(() => vi.fn());

vi.mock("../utils/terminal.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../utils/terminal.js")>();
  return {
    ...mod,
    confirmProjectRoot: (...args: unknown[]) => mockConfirmProjectRoot(...args),
    isNonInteractive: () => true,
  };
});

vi.mock("../lifecycle/resolve-cli.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lifecycle/resolve-cli.js")>();
  return {
    ...mod,
    resolveRegistryFromCli: (...args: unknown[]) => mockResolveRegistryFromCli(...args),
  };
});

describe("post-install next-step copy", () => {
  it("points at /agent-kit-onboard when readiness has pending actions", () => {
    expect(nextStepAfterInstall(3)).toContain("/agent-kit-onboard");
  });

  it("points at /start-project when readiness is clear", () => {
    expect(nextStepAfterInstall(0)).toContain("/start-project");
  });

  it("never names a bare agent-kit binary as the next step", () => {
    // `npx @dadado/agent-kit-cli install` is ephemeral: it leaves no
    // `agent-kit` on PATH, so the success banner must not imply one.
    for (const copy of [nextStepAfterInstall(0), nextStepAfterInstall(1)]) {
      expect(copy).not.toMatch(/(^|[\s`"'])agent-kit\s/);
    }
  });
});

describe("printInstallEpilogue", () => {
  it("prints a short positive line and skips the numbered options when the bin is already on PATH", () => {
    const lines: string[] = [];
    printInstallEpilogue(makeEnvReport({ binOnPath: true }), {
      color: false,
      print: (line) => lines.push(line),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("agent-kit");
    expect(lines[0]).toContain("PATH");
    expect(lines.join("\n")).not.toContain("setup-global");
  });

  it("prints all 3 numbered options, mentioning setup-global, when the bin is not on PATH", () => {
    const lines: string[] = [];
    printInstallEpilogue(makeEnvReport({ binOnPath: false }), {
      color: false,
      print: (line) => lines.push(line),
    });
    const printed = lines.join("\n");
    expect(printed).toContain("1. Keep using npx");
    expect(printed).toContain("npx @dadado/agent-kit-cli <subcommand>");
    expect(printed).toContain("2. Put a bare `agent-kit` on PATH");
    expect(printed).toContain("npx @dadado/agent-kit-cli setup-global");
    expect(printed).toContain("3. Manual steps");
    expect(printed).toContain("docs/getting-started.md");
    // Beginner-first: name the symptom before the choices.
    expect(printed.indexOf("won't work yet")).toBeLessThan(printed.indexOf("1. Keep using npx"));
  });

  it("emits no ANSI escape codes when color is disabled (NO_COLOR/CI fallback)", () => {
    const lines: string[] = [];
    printInstallEpilogue(makeEnvReport({ binOnPath: false }), {
      color: false,
      print: (line) => lines.push(line),
    });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the absence of ANSI escapes
    const ansiEscape = /\[[0-9;]*m/;
    for (const line of lines) {
      expect(line).not.toMatch(ansiEscape);
    }
  });

  it("emits ANSI escape codes when color is enabled", () => {
    const lines: string[] = [];
    printInstallEpilogue(makeEnvReport({ binOnPath: false }), {
      color: true,
      print: (line) => lines.push(line),
    });
    const printed = lines.join("\n");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting presence of ANSI escapes
    expect(printed).toMatch(/\[[0-9;]*m/);
  });
});

describe("installCommand RootRefusedError", () => {
  afterEach(() => {
    mockConfirmProjectRoot.mockReset();
    process.exitCode = undefined;
  });

  it("sets exitCode and returns without process.exit on root refusal", async () => {
    mockConfirmProjectRoot.mockRejectedValue(new RootRefusedError("/tmp/not-a-project"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called on RootRefusedError");
    }) as never);

    try {
      await (
        installCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
      )({
        args: {
          _: [],
          cwd: "/tmp/not-a-project",
          yes: true,
          "force-root": false,
          pack: undefined as unknown as string,
          profile: undefined as unknown as string,
          registry: undefined as unknown as string,
          url: undefined as unknown as string,
          ref: undefined as unknown as string,
          refresh: false,
        },
      });
      expect(process.exitCode).toBe(1);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("prints the start-from-zero recovery block on a root refusal", async () => {
    mockConfirmProjectRoot.mockRejectedValue(
      new RootRefusedError(
        "/tmp/blank",
        "Refused /tmp/blank: no .git and no .cursor/agent-kit.json.",
        "  1. git init\n  2. --force-root",
      ),
    );
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await (
        installCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
      )({
        args: {
          _: [],
          cwd: "/tmp/blank",
          yes: true,
          "force-root": false,
          pack: undefined as unknown as string,
          profile: undefined as unknown as string,
          registry: undefined as unknown as string,
          url: undefined as unknown as string,
          ref: undefined as unknown as string,
          refresh: false,
        },
      });
      expect(process.exitCode).toBe(1);
      const printed = consoleErrorSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("git init");
      expect(printed).toContain("--force-root");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("sets exitCode and prints the recovery hint without process.exit on generic install failure", async () => {
    mockConfirmProjectRoot.mockResolvedValue("/tmp/some-project");
    mockResolveRegistryFromCli.mockRejectedValue(new Error("registry resolution exploded"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called on the generic failure path");
    }) as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await (
        installCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>
      )({
        args: {
          _: [],
          cwd: "/tmp/some-project",
          yes: true,
          "force-root": false,
          pack: undefined as unknown as string,
          profile: undefined as unknown as string,
          registry: undefined as unknown as string,
          url: undefined as unknown as string,
          ref: undefined as unknown as string,
          refresh: false,
        },
      });
      expect(process.exitCode).toBe(1);
      expect(exitSpy).not.toHaveBeenCalled();
      // Recovery hint reaches stderr before the command returns (no truncation
      // risk from an immediate exit on piped stderr).
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      mockResolveRegistryFromCli.mockReset();
    }
  });
});
