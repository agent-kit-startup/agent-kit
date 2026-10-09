import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRunnerStateDir } from "../../../../dashboard/lib/run-logs.mjs";
import {
  HANDOFF_REL,
  STATE_ROOT_ENV,
  ensureLoopLogsDir,
  resolveStateDir,
  runnerStatePaths,
} from "./kit-paths.js";

describe("kit paths", () => {
  it("keeps the HANDOFF literal stable (POSIX)", () => {
    expect(HANDOFF_REL).toBe(".cursor/HANDOFF.md");
    expect(HANDOFF_REL.includes("\\")).toBe(false);
  });
});

describe("runner state root (AGENT_KIT_STATE_ROOT)", () => {
  it("defaults to .cursor, accepts .agent-kit, rejects anything else", () => {
    expect(resolveStateDir({})).toEqual({ stateDir: ".cursor" });
    expect(resolveStateDir({ [STATE_ROOT_ENV]: ".agent-kit" })).toEqual({ stateDir: ".agent-kit" });
    expect(resolveStateDir({ [STATE_ROOT_ENV]: ".agent-kit/" })).toEqual({
      stateDir: ".agent-kit",
    });
    expect(resolveStateDir({ [STATE_ROOT_ENV]: "../elsewhere" })).toEqual({
      stateDir: ".cursor",
      invalid: "../elsewhere",
    });
    const paths = runnerStatePaths("/repo", { [STATE_ROOT_ENV]: ".agent-kit" });
    expect(paths.loopLogsDir).toBe(path.join("/repo", ".agent-kit", "loop-logs"));
    expect(paths.stopFile).toBe(path.join("/repo", ".agent-kit", "loop.stop"));
  });

  it("the dashboard mirror resolves the same dir for every input", () => {
    for (const value of [undefined, "", ".cursor", ".agent-kit", ".agent-kit/", "x", "/abs"]) {
      const env = value === undefined ? {} : { [STATE_ROOT_ENV]: value };
      expect(resolveRunnerStateDir(env)).toBe(resolveStateDir(env).stateDir);
    }
  });

  it("outside .cursor the loop-logs dir ignores itself so logs never reach a commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ak-state-root-"));
    const alt = runnerStatePaths(root, { [STATE_ROOT_ENV]: ".agent-kit" });
    await ensureLoopLogsDir(alt);
    expect(await readFile(path.join(alt.loopLogsDir, ".gitignore"), "utf8")).toBe("*\n");
    await ensureLoopLogsDir(alt); // idempotent
    const def = runnerStatePaths(root, {});
    await ensureLoopLogsDir(def);
    await expect(readFile(path.join(def.loopLogsDir, ".gitignore"), "utf8")).rejects.toThrow();
  });
});
