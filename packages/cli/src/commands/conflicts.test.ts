import { describe, expect, it, vi } from "vitest";
import { logger } from "../utils/logger.js";
import { conflictsCommand } from "./conflicts.js";

type Args = Record<string, { description?: string; default?: unknown }>;

function proposeArgs(): Args {
  const sub = (conflictsCommand.subCommands as Record<string, { args?: Args }> | undefined)
    ?.propose;
  if (!sub?.args) throw new Error("conflicts propose has no args");
  return sub.args;
}

describe("agent-kit conflicts propose --help", () => {
  it("says what verification runs, and as whom", () => {
    const verify = proposeArgs().verify?.description ?? "";
    for (const words of [
      "model's text",
      "before anyone has reviewed them",
      "unsandboxed",
      "as you",
      "Off by default",
    ]) {
      expect(verify).toContain(words);
    }
  });

  it("does not verify unless --verify is passed", () => {
    expect(proposeArgs().verify?.default).toBe(false);
  });

  it("refuses --verify-cmd without --verify instead of skipping it silently", async () => {
    const sub = (
      conflictsCommand.subCommands as Record<string, { run?: (ctx: unknown) => unknown }>
    ).propose;
    const before = process.exitCode;
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      await sub?.run?.({
        args: { path: "a.txt", cwd: ".", backend: "nope", verify: false, "verify-cmd": "true" },
      });
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("--verify-cmd only applies with --verify"),
      );
    } finally {
      error.mockRestore();
      process.exitCode = before;
    }
  });

  it("gives a ready --verify-cmd recipe with the install first", () => {
    const cmd = proposeArgs()["verify-cmd"]?.description ?? "";
    expect(cmd).toContain(
      "--verify-cmd 'pnpm install --frozen-lockfile --prefer-offline && pnpm test'",
    );
    expect(cmd).toContain("npm ci --prefer-offline && npm test");
  });
});
