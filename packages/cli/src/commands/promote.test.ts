import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLI_HELP_GROUPS } from "../welcome/help-groups.js";
import {
  type GhRunner,
  promoteCommand,
  promotePrViewArgs,
  promoteWaitExitCode,
  runPromoteRules,
  runPromoteWait,
} from "./promote.js";

const OPEN = JSON.stringify({
  state: "OPEN",
  mergedAt: null,
  mergeCommit: null,
  mergeStateStatus: "CLEAN",
  url: "https://github.com/o/r/pull/7",
});
const MERGED = JSON.stringify({
  state: "MERGED",
  mergedAt: "2026-11-07T12:00:00Z",
  mergeCommit: { oid: "abc1234" },
  mergeStateStatus: "UNKNOWN",
  url: "https://github.com/o/r/pull/7",
});

async function tmpWorkspace(config?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "promote-wait-"));
  if (config) {
    await mkdir(path.join(dir, ".cursor", "context"), { recursive: true });
    await writeFile(path.join(dir, ".cursor", "context", "config.json"), JSON.stringify(config));
  }
  return dir;
}

describe("agent-kit promote wait", () => {
  it("is listed in root help and exposes the wait subcommand", () => {
    expect(CLI_HELP_GROUPS.flatMap((g) => g.commands)).toContain("promote");
    expect(Object.keys(promoteCommand.subCommands ?? {})).toEqual(["wait", "rules"]);
  });

  it("reads the PR with gh pr view --json, optionally on another repo", () => {
    expect(promotePrViewArgs(7)).toEqual([
      "pr",
      "view",
      "7",
      "--json",
      "state,mergedAt,mergeCommit,mergeStateStatus,url",
    ]);
    expect(promotePrViewArgs(7, "o/r").slice(-2)).toEqual(["--repo", "o/r"]);
  });

  it("uses the config cap and exits 3 with the Ask when the PR stays open", async () => {
    const cwd = await tmpWorkspace({ promoteMergeWaitMs: 60_000 });
    const runGh = vi.fn<GhRunner>().mockResolvedValue(OPEN);
    const { result, capMs } = await runPromoteWait({ pr: 7, cwd, runGh, sleep: async () => {} });
    expect(capMs).toBe(60_000);
    expect(result.outcome).toBe("timeout");
    expect(promoteWaitExitCode(result)).toBe(3);
    for (const call of runGh.mock.calls) expect(call[0].slice(0, 2)).toEqual(["pr", "view"]);
  });

  it("defaults the cap to 60 minutes when config.json is missing, and exits 0 on merge", async () => {
    const cwd = await tmpWorkspace();
    const runGh = vi.fn<GhRunner>().mockResolvedValueOnce(OPEN).mockResolvedValueOnce(MERGED);
    const { result, capMs } = await runPromoteWait({ pr: 7, cwd, runGh, sleep: async () => {} });
    expect(capMs).toBe(60 * 60 * 1000);
    expect(result.outcome).toBe("merged");
    expect(promoteWaitExitCode(result)).toBe(0);
  });

  it("exits 1 for a PR closed without a merge", async () => {
    const cwd = await tmpWorkspace();
    const runGh = vi.fn<GhRunner>().mockResolvedValue(OPEN.replace('"OPEN"', '"CLOSED"'));
    const { result } = await runPromoteWait({ pr: 7, cwd, runGh, sleep: async () => {} });
    expect(promoteWaitExitCode(result)).toBe(1);
  });
});

describe("agent-kit promote rules", () => {
  it("runs gh api in the workspace and returns the parsed rules", async () => {
    const cwd = await tmpWorkspace();
    const runGh = vi
      .fn<GhRunner>()
      .mockResolvedValue(
        JSON.stringify([
          { type: "pull_request", parameters: { require_last_push_approval: true }, ruleset_id: 1 },
        ]),
      );
    const r = await runPromoteRules({ base: "main", cwd, runGh });
    expect(runGh).toHaveBeenCalledWith(["api", "repos/{owner}/{repo}/rules/branches/main"], {
      cwd,
    });
    expect(r.ok).toBe(true);
  });

  it("an API error is a note, never a throw", async () => {
    const cwd = await tmpWorkspace();
    const runGh = vi.fn<GhRunner>().mockRejectedValue(new Error("HTTP 404: Not Found"));
    const r = await runPromoteRules({ base: "main", cwd, runGh });
    expect(r).toEqual({ ok: false, note: "HTTP 404: Not Found" });
  });
});
