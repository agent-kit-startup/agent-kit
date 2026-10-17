import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultExec,
  type ExecFn,
  GATE_EXIT_MARKER_RELPATH,
  type GateExitMarker,
  type GateExitOutcome,
  landGateExit,
  readGateExitMarker,
  writeGateExitMarker,
} from "../plan-loop/gate-exit.js";
import {
  acceptTicket,
  discardTicket,
  formatGroundControlStatus,
  GROUND_CONTROL_EXIT,
  groundControlCommand,
  groundControlErrorText,
  groundControlStatus,
} from "./ground-control.js";

/** Git isolated from the host's global/system config (hooks, signing). */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ground Control Test",
  GIT_AUTHOR_EMAIL: "ground-control-test@example.com",
  GIT_COMMITTER_NAME: "Ground Control Test",
  GIT_COMMITTER_EMAIL: "ground-control-test@example.com",
};

const STAMP = "20261014T093005Z";
const BRANCH = `gate-exit/${STAMP}`;
const NOTE = `.cursor/gate-exit/${STAMP}.md`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

function hasRef(cwd: string, ref: string): boolean {
  try {
    git(cwd, "rev-parse", "--verify", "--quiet", ref);
    return true;
  } catch {
    return false;
  }
}

/** A repository on `staging` with the kit's ignore rules; optionally a bare `origin`. */
async function repo(opts: { origin?: boolean } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-ground-control-test-"));
  const root = path.join(dir, "root");
  const bare = path.join(dir, "origin.git");
  await mkdir(root);
  git(root, "init", "-q", "-b", "staging");
  await writeFile(
    path.join(root, ".gitignore"),
    ".cursor/context/gate-exit.json\n.cursor/loop-logs/\n",
  );
  await writeFile(path.join(root, "README.md"), "fixture\n");
  git(root, "add", ".gitignore", "README.md");
  git(root, "commit", "-q", "-m", "seed");
  if (opts.origin !== false) {
    git(dir, "init", "-q", "--bare", "-b", "staging", bare);
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "origin", "staging");
  }
  const logPath = path.join(root, ".cursor", "loop-logs", "tick-1.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, "HITL_GATE: backlog-write | Write plan to backlog | Cancel\n");
  return { dir, root, bare, logPath };
}

function outcome(logPath: string): GateExitOutcome {
  return {
    trigger: "gate",
    exitCode: 4,
    reason: "stopped: unanswered gate (--no-hitl)",
    askId: "backlog-write",
    command: "run backlog-add",
    backend: "claude",
    logPath,
  };
}

/** Land one gate exit at STAMP (pushed when `origin` exists), plus a skipped record. */
async function landed(opts: { origin?: boolean } = {}) {
  const fx = await repo(opts);
  const result = await landGateExit({
    root: fx.root,
    outcome: outcome(fx.logPath),
    env: GIT_ENV,
    now: new Date("2026-10-14T09:30:05Z"),
    which: async () => null,
  });
  expect(result.committed).toBe(true);
  const marker = await readGateExitMarker(fx.root);
  if (marker.kind !== "ok") throw new Error("marker not written");
  await writeGateExitMarker(fx.root, {
    ...marker.marker,
    skipped: ["skipped 20261015T030000Z"],
  });
  return fx;
}

/** Fast-forward `staging` on the bare origin to the gate-exit branch (a plain merge). */
function mergeOnOrigin(root: string) {
  git(root, "push", "-q", "origin", `refs/remotes/origin/${BRANCH}:refs/heads/staging`);
}

/** Squash-merge: the note lands on `staging` as a new commit; the branch is not an ancestor. */
async function squashOnOrigin(dir: string, bare: string) {
  const clone = path.join(dir, "squash");
  git(dir, "clone", "-q", "-b", "staging", bare, clone);
  git(clone, "checkout", "-q", `origin/${BRANCH}`, "--", NOTE);
  git(clone, "commit", "-q", "-m", "squash gate exit");
  git(clone, "push", "-q", "origin", "staging");
}

function snapshot(root: string) {
  return {
    head: git(root, "rev-parse", "HEAD"),
    branch: git(root, "rev-parse", "--abbrev-ref", "HEAD"),
    status: git(root, "status", "--porcelain", "--untracked-files=all"),
  };
}

const base = { env: GIT_ENV };

describe("ground-control command surface", () => {
  it("has exactly status, accept and discard (no merge, no promotion verb)", () => {
    const subs = groundControlCommand.subCommands as Record<string, unknown>;
    expect(Object.keys(subs).sort()).toEqual(["accept", "discard", "status"]);
  });
});

describe("ground-control status", () => {
  it("lists the pending ticket with Ask id, labels, headline, branch state and skipped runs", async () => {
    const { root } = await landed();
    const status = await groundControlStatus({ cwd: root, ...base });
    if (typeof status === "string") throw new Error(status);
    expect(status.marker).toBe("ok");
    expect(status.base).toBe("staging");
    expect(status.skipped).toEqual(["skipped 20261015T030000Z"]);
    expect(status.tickets).toHaveLength(1);
    const [t] = status.tickets;
    expect(t).toMatchObject({
      stamp: STAMP,
      askId: "backlog-write",
      labels: ["Write plan to backlog", "Cancel"],
      branch: `origin/${BRANCH}`,
      branchState: "unmerged",
      inMarker: true,
    });
    expect(t?.headline).toBe(`# Gate exit ${STAMP}: unanswered gate \`backlog-write\``);
    const text = formatGroundControlStatus(status);
    expect(text).toContain("1 pending operator ticket");
    expect(text).toContain("Ask id: backlog-write | labels: Write plan to backlog / Cancel");
    expect(text).toContain("Skipped runs: 1 (latest: skipped 20261015T030000Z)");
  });

  it("reports an unmerged branch with no marker entry and hides merged history", async () => {
    const { root } = await landed();
    await writeGateExitMarker(root, { schema: 1, pending: [], skipped: [] });
    let status = await groundControlStatus({ cwd: root, ...base });
    if (typeof status === "string") throw new Error(status);
    expect(status.tickets.map((t) => [t.stamp, t.inMarker, t.branchState])).toEqual([
      [STAMP, false, "unmerged"],
    ]);
    expect(formatGroundControlStatus(status)).toContain("Not in .cursor/context/gate-exit.json");
    mergeOnOrigin(root);
    status = await groundControlStatus({ cwd: root, ...base });
    if (typeof status === "string") throw new Error(status);
    expect(status.tickets).toEqual([]);
  });

  it("says so when there is nothing to triage", async () => {
    const { root } = await repo();
    const status = await groundControlStatus({ cwd: root, ...base });
    if (typeof status === "string") throw new Error(status);
    expect(status.marker).toBe("absent");
    expect(formatGroundControlStatus(status)).toContain("no pending operator ticket");
  });
});

describe("ground-control accept against a disposable bare mirror", () => {
  it("refuses an unmerged branch with exit 2 and changes nothing", async () => {
    const { root, bare } = await landed();
    const before = snapshot(root);
    const markerBefore = await readFile(path.join(root, GATE_EXIT_MARKER_RELPATH), "utf8");
    const lines: string[] = [];
    const result = await acceptTicket({
      cwd: root,
      stamp: STAMP,
      ...base,
      log: (l) => lines.push(l),
    });
    expect(result.exitCode).toBe(GROUND_CONTROL_EXIT.waiting);
    expect(lines.join("\n")).toContain("not merged into staging yet; waiting on the merge");
    expect(hasRef(bare, `refs/heads/${BRANCH}`)).toBe(true);
    expect(await readFile(path.join(root, GATE_EXIT_MARKER_RELPATH), "utf8")).toBe(markerBefore);
    expect(snapshot(root)).toEqual(before);
  });

  it("deletes a merged branch and clears only that entry, keeping skipped records", async () => {
    const { root, bare } = await landed();
    mergeOnOrigin(root);
    const before = snapshot(root);
    const result = await acceptTicket({ cwd: root, stamp: STAMP, ...base });
    expect(result).toEqual({ exitCode: 0 });
    expect(hasRef(bare, `refs/heads/${BRANCH}`)).toBe(false);
    expect(hasRef(bare, "refs/heads/staging")).toBe(true);
    const marker = await readGateExitMarker(root);
    expect(marker.kind === "ok" && marker.marker).toEqual({
      schema: 1,
      pending: [],
      skipped: ["skipped 20261015T030000Z"],
    } satisfies GateExitMarker);
    expect(snapshot(root)).toEqual(before);
  });

  it("treats a squash merge (identical note on the base) as merged", async () => {
    const { dir, root, bare } = await landed();
    await squashOnOrigin(dir, bare);
    const result = await acceptTicket({ cwd: root, stamp: STAMP, ...base });
    expect(result.exitCode).toBe(0);
    expect(hasRef(bare, `refs/heads/${BRANCH}`)).toBe(false);
  });

  it("clears the ticket when the forge already deleted the merged branch", async () => {
    const { dir, root, bare } = await landed();
    await squashOnOrigin(dir, bare);
    git(bare, "branch", "-D", BRANCH);
    const result = await acceptTicket({ cwd: root, stamp: STAMP, ...base });
    expect(result.exitCode).toBe(0);
    const marker = await readGateExitMarker(root);
    expect(marker.kind === "ok" && marker.marker.pending).toEqual([]);
  });

  it("waits when the branch is gone but its note never reached the base", async () => {
    const { root, bare } = await landed();
    git(bare, "branch", "-D", BRANCH);
    const result = await acceptTicket({ cwd: root, stamp: STAMP, ...base });
    expect(result.exitCode).toBe(GROUND_CONTROL_EXIT.waiting);
    const marker = await readGateExitMarker(root);
    expect(marker.kind === "ok" && marker.marker.pending).toHaveLength(1);
  });
});

describe("ground-control discard against a disposable bare mirror", () => {
  it("closes the PR when gh is authenticated, deletes the branch and clears the entry", async () => {
    const { root, bare } = await landed();
    const before = snapshot(root);
    const forgeCalls: string[][] = [];
    const exec: ExecFn = async (bin, args, opts) => {
      if (bin === "/fake/gh") {
        forgeCalls.push([...args]);
        return { code: 0, stdout: "", stderr: "" };
      }
      return defaultExec(bin, args, opts);
    };
    const result = await discardTicket({
      cwd: root,
      stamp: STAMP,
      ...base,
      exec,
      which: async (bin) => (bin === "gh" ? "/fake/gh" : null),
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(forgeCalls).toEqual([
      ["auth", "status"],
      ["pr", "close", BRANCH, "--comment", "Discarded with agent-kit ground-control."],
    ]);
    expect(hasRef(bare, `refs/heads/${BRANCH}`)).toBe(false);
    const marker = await readGateExitMarker(root);
    expect(marker.kind === "ok" && marker.marker.pending).toEqual([]);
    expect(marker.kind === "ok" && marker.marker.skipped).toEqual(["skipped 20261015T030000Z"]);
    expect(snapshot(root)).toEqual(before);
  });

  it("deletes the branch without a forge and on an unmerged branch (discard always deletes)", async () => {
    const { root, bare } = await landed();
    const lines: string[] = [];
    const result = await discardTicket({
      cwd: root,
      stamp: STAMP,
      ...base,
      which: async () => null,
      log: (l) => lines.push(l),
    });
    expect(result.exitCode).toBe(0);
    expect(lines.join("\n")).toContain("no authenticated gh/glab");
    expect(hasRef(bare, `refs/heads/${BRANCH}`)).toBe(false);
  });

  it("deletes a local-only branch when there is no origin", async () => {
    const { root } = await landed({ origin: false });
    expect(hasRef(root, `refs/heads/${BRANCH}`)).toBe(true);
    const status = await groundControlStatus({ cwd: root, ...base });
    if (typeof status === "string") throw new Error(status);
    expect(status.tickets[0]).toMatchObject({ branch: BRANCH, branchState: "unmerged" });
    const result = await discardTicket({ cwd: root, stamp: STAMP, ...base });
    expect(result.exitCode).toBe(0);
    expect(hasRef(root, `refs/heads/${BRANCH}`)).toBe(false);
    expect(git(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("staging");
  });
});

describe("ground-control refusals", () => {
  it("rejects a malformed stamp before touching git (no injection path)", async () => {
    const calls: string[] = [];
    const exec: ExecFn = async (bin, args) => {
      calls.push(`${bin} ${args.join(" ")}`);
      return { code: 0, stdout: "", stderr: "" };
    };
    for (const stamp of ["--force", "20261014T093005Z;rm", "../staging", "git-prod", ""]) {
      for (const fn of [acceptTicket, discardTicket]) {
        const result = await fn({ cwd: "/nonexistent", stamp, ...base, exec });
        expect(result.exitCode).toBe(GROUND_CONTROL_EXIT.usage);
      }
    }
    expect(calls).toEqual([]);
  });

  it("refuses an unknown stamp with exit 1", async () => {
    const { root } = await repo();
    const result = await acceptTicket({ cwd: root, stamp: STAMP, ...base });
    expect(result.exitCode).toBe(GROUND_CONTROL_EXIT.usage);
    expect(result.error).toContain(`no ticket ${STAMP}`);
  });

  it("leaves an unreadable marker alone (exit 3)", async () => {
    const { root } = await landed();
    const file = path.join(root, GATE_EXIT_MARKER_RELPATH);
    await writeFile(file, "{not json");
    const result = await discardTicket({
      cwd: root,
      stamp: STAMP,
      ...base,
      which: async () => null,
    });
    expect(result.exitCode).toBe(GROUND_CONTROL_EXIT.failed);
    expect(await readFile(file, "utf8")).toBe("{not json");
  });
});

describe("ground-control error lines", () => {
  it("redact forge and backend tokens before they reach the terminal", () => {
    const token = ["seeded", "forge", "v+1/x="].join("-");
    const key = ["seeded", "backend", "v+2/x="].join("-");
    const env = { GITLAB_TOKEN: token, ANTHROPIC_API_KEY: key };
    const text = groundControlErrorText(
      `git fetch --prune failed: https://oauth2:${token}@forge.example/r.git ${encodeURIComponent(key)}`,
      env,
    );
    expect(text).not.toContain(token);
    expect(text).not.toContain(encodeURIComponent(key));
    expect(text).toContain("[GITLAB_TOKEN]");
    expect(text).toContain("[ANTHROPIC_API_KEY]");
  });
});
