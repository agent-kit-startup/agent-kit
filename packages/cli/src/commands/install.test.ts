import { afterEach, describe, expect, it, vi } from "vitest";
import { RootRefusedError } from "../utils/terminal.js";
import { installCommand } from "./install.js";

const mockConfirmProjectRoot = vi.hoisted(() => vi.fn());

vi.mock("../utils/terminal.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../utils/terminal.js")>();
  return {
    ...mod,
    confirmProjectRoot: (...args: unknown[]) => mockConfirmProjectRoot(...args),
    isNonInteractive: () => true,
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
});
