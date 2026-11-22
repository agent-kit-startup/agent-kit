import { describe, expect, it } from "vitest";
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
      "--no-verify",
    ]) {
      expect(verify).toContain(words);
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
