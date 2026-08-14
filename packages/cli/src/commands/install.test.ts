import { afterEach, describe, expect, it, vi } from "vitest";
import { RootRefusedError } from "../utils/terminal.js";
import { installCommand } from "./install.js";

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
