import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGateExitNote,
  classifyGateExit,
  decodeRunLog,
  defaultExec,
  type ExecFn,
  GATE_EXIT_MARKER_RELPATH,
  type GateExitOutcome,
  gateExitBranch,
  gateExitStamp,
  isSafeBaseRef,
  landGateExit,
  readGateExitMarker,
} from "./gate-exit.js";
import { unansweredStop } from "./hitl-relay.js";

/** Git isolated from the host's global/system config (hooks, signing, algorithms). */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_DATE: "2026-10-14T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-10-14T00:00:00Z",
};
const SECRET = "example-gate-exit-auth-value";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

/** A disposable bare mirror (`origin`) with a `staging` branch, and a clone as the invocation root. */
async function mirror(opts: { origin?: boolean; identity?: boolean } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-gate-exit-test-"));
  const bare = path.join(dir, "origin.git");
  const root = path.join(dir, "root");
  await mkdir(root);
  git(root, "init", "-q", "-b", "staging");
  if (opts.identity !== false) {
    git(root, "config", "user.email", "gate-exit-test@example.com");
    git(root, "config", "user.name", "Gate Exit Test");
  }
  await writeFile(
    path.join(root, ".gitignore"),
    ".cursor/context/gate-exit.json\n.cursor/loop-logs/\n",
  );
  await writeFile(path.join(root, "README.md"), "fixture\n");
  git(
    root,
    "-c",
    "user.name=seed",
    "-c",
    "user.email=seed@example.com",
    "add",
    ".gitignore",
    "README.md",
  );
  git(
    root,
    "-c",
    "user.name=seed",
    "-c",
    "user.email=seed@example.com",
    "commit",
    "-q",
    "-m",
    "init",
  );
  if (opts.origin !== false) {
    git(dir, "init", "-q", "--bare", bare);
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "origin", "staging");
  }
  // A gate line in the run log (ignored path), and a dirty tracked file.
  const logPath = path.join(root, ".cursor", "loop-logs", "tick-1.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(
    logPath,
    "assistant text\nHITL_GATE: other-gate | X | Y\nHITL_GATE: backlog-pick | Accept | Change | Cancel\n",
  );
  await writeFile(path.join(root, "README.md"), "fixture, edited by the operator\n");
  return { dir, bare, root, logPath };
}

function snapshotRoot(root: string) {
  return {
    head: git(root, "rev-parse", "HEAD"),
    status: git(root, "status", "--porcelain", "--untracked-files=all"),
    worktrees: git(root, "worktree", "list", "--porcelain"),
  };
}

function gateOutcome(logPath: string, summary?: string): GateExitOutcome {
  return {
    trigger: "gate",
    exitCode: 4,
    reason: "stopped: unanswered gate (--no-hitl)",
    askId: "backlog-pick",
    command: "run-plan",
    backend: "claude",
    plan: "demo.plan.md",
    ticks: 1,
    pending: 2,
    logPath,
    ...(summary ? { summary } : {}),
  };
}

const noForge = async () => null;

describe("classifyGateExit", () => {
  it("lands gate stops, operator stops and failures only", () => {
    expect(classifyGateExit({ stop: unansweredStop("a", "--no-hitl"), failed: false })).toBe(
      "gate",
    );
    expect(
      classifyGateExit({
        stop: {
          askId: "a",
          cause: "EOF",
          message: "stopped-by-operator: gate a, no reply (EOF)",
          exitCode: 4,
        },
        failed: false,
      }),
    ).toBe("stopped-by-operator");
    expect(classifyGateExit({ failed: true })).toBe("failure");
    expect(classifyGateExit({ failed: false })).toBeNull();
  });
});

describe("identifiers", () => {
  it("stamps in UTC to the second and validates the branch name", () => {
    const stamp = gateExitStamp(new Date("2026-10-14T09:30:05.123Z"));
    expect(stamp).toBe("20261014T093005Z");
    expect(gateExitBranch(stamp)).toBe("gate-exit/20261014T093005Z");
    expect(() => gateExitBranch("x; rm -rf /")).toThrow(/invalid gate-exit stamp/);
  });

  it("refuses option-like or traversal base refs", () => {
    expect(isSafeBaseRef("staging")).toBe(true);
    expect(isSafeBaseRef("release/6.1")).toBe(true);
    expect(isSafeBaseRef("--upload-pack=x")).toBe(false);
    expect(isSafeBaseRef("a..b")).toBe(false);
  });
});

describe("decodeRunLog", () => {
  it("finds a gate line inside a stream-json result (escaped newlines)", () => {
    const line = JSON.stringify({
      type: "result",
      result: "Pick one.\n1. Go\n2. Stop\nHITL_GATE: pick | Go | Stop",
    });
    expect(decodeRunLog(`${line}\n`)).toMatch(/^HITL_GATE: pick \| Go \| Stop$/m);
  });
});

describe("buildGateExitNote", () => {
  const base = {
    stamp: "20261014T093005Z",
    labels: ["Accept", "Cancel"],
    base: "staging",
    logRel: ".cursor/loop-logs/tick-1.log",
    dirtyPaths: 0,
  };

  it("note-only: provenance, ask id, gate line and log pointer; no summary section", () => {
    const note = buildGateExitNote({ ...base, outcome: gateOutcome("/x/tick-1.log") });
    expect(note.split("\n")[0]).toBe(
      "# Gate exit 20261014T093005Z: unanswered gate `backlog-pick`",
    );
    expect(note).toContain("agent-inferred");
    expect(note).toContain("`HITL_GATE: backlog-pick | Accept | Cancel`");
    expect(note).toContain("`.cursor/loop-logs/tick-1.log`");
    expect(note).not.toContain("## Run summary");
  });

  it("note+summary: carries the summary, capped", () => {
    const note = buildGateExitNote({
      ...base,
      outcome: gateOutcome("/x/tick-1.log", `${"a".repeat(9000)}`),
    });
    expect(note).toContain("## Run summary");
    expect(note).toContain("(summary truncated at 8192 characters)");
  });
});

describe("landGateExit against a disposable bare mirror", () => {
  it("pushes a gate-exit branch with the note, leaves the root tree untouched, writes the marker", async () => {
    const { bare, root, logPath } = await mirror();
    const before = snapshotRoot(root);
    const lines: string[] = [];
    const now = new Date("2026-10-14T09:30:05Z");
    const res = await landGateExit({
      root,
      outcome: gateOutcome(logPath, `tick summary mentioning ${SECRET}`),
      env: { ...GIT_ENV, ANTHROPIC_API_KEY: SECRET },
      now,
      which: noForge,
      log: (l) => lines.push(l),
    });

    expect(res).toMatchObject({
      stamp: "20261014T093005Z",
      branch: "gate-exit/20261014T093005Z",
      committed: true,
      pushed: true,
      url: null,
      markerWritten: true,
    });
    expect(snapshotRoot(root)).toEqual(before);
    expect(git(root, "branch", "--list", "gate-exit/*")).toBe("");

    const note = git(
      bare,
      "show",
      "gate-exit/20261014T093005Z:.cursor/gate-exit/20261014T093005Z.md",
    );
    expect(note).toContain("agent-inferred");
    expect(note).toContain("`HITL_GATE: backlog-pick | Accept | Change | Cancel`");
    expect(note).toContain("## Run summary");
    expect(note).toContain("[ANTHROPIC_API_KEY]");
    expect(note).not.toContain(SECRET);
    expect(note).toContain("dirty (1 path(s)), reported and not cleaned");
    // Branch off origin/staging: one commit on top, only the note.
    expect(git(bare, "log", "--format=%s", "gate-exit/20261014T093005Z")).toBe(
      "docs(gate-exit): record the gate of 20261014T093005Z\ninit",
    );
    expect(git(bare, "diff", "--name-only", "staging", "gate-exit/20261014T093005Z")).toBe(
      ".cursor/gate-exit/20261014T093005Z.md",
    );

    const marker = await readGateExitMarker(root);
    expect(marker).toMatchObject({
      kind: "ok",
      marker: {
        schema: 1,
        skipped: [],
        pending: [
          {
            stamp: "20261014T093005Z",
            askId: "backlog-pick",
            labels: ["Accept", "Change", "Cancel"],
            branch: "gate-exit/20261014T093005Z",
            pushed: true,
            base: "staging",
          },
        ],
      },
    });
    expect(lines.join("\n")).toContain("open the review by hand: gh pr create --base staging");
    expect(lines.join("\n")).not.toContain(SECRET);
  });

  it("note-only landing (no summary) and a second landing appends to the marker", async () => {
    const { bare, root, logPath } = await mirror({ identity: false });
    await landGateExit({
      root,
      outcome: gateOutcome(logPath),
      env: GIT_ENV,
      now: new Date("2026-10-14T01:00:00Z"),
      which: noForge,
    });
    const second = await landGateExit({
      root,
      outcome: { ...gateOutcome(logPath), trigger: "failure", askId: undefined },
      env: GIT_ENV,
      now: new Date("2026-10-14T02:00:00Z"),
      which: noForge,
    });
    expect(second.pushed).toBe(true);
    const note = git(
      bare,
      "show",
      "gate-exit/20261014T010000Z:.cursor/gate-exit/20261014T010000Z.md",
    );
    expect(note).not.toContain("## Run summary");
    // No repo identity: the fallback identity commits.
    expect(git(bare, "log", "-1", "--format=%an", "gate-exit/20261014T010000Z")).toBe("agent-kit");
    const marker = await readGateExitMarker(root);
    expect(marker.kind === "ok" && marker.marker.pending.map((e) => e.stamp)).toEqual([
      "20261014T010000Z",
      "20261014T020000Z",
    ]);
  });

  it("no origin: nothing is pushed, the branch stays local, the marker is written", async () => {
    const { root, logPath } = await mirror({ origin: false });
    const before = snapshotRoot(root);
    const lines: string[] = [];
    const res = await landGateExit({
      root,
      outcome: gateOutcome(logPath),
      env: GIT_ENV,
      now: new Date("2026-10-14T03:00:00Z"),
      which: noForge,
      log: (l) => lines.push(l),
    });
    expect(res).toMatchObject({
      pushed: false,
      committed: true,
      branch: "gate-exit/20261014T030000Z",
    });
    expect(snapshotRoot(root)).toEqual(before);
    expect(git(root, "branch", "--list", "gate-exit/*")).toContain("gate-exit/20261014T030000Z");
    expect(lines.join("\n")).toContain("nothing is pushed");
    const marker = await readGateExitMarker(root);
    expect(marker.kind === "ok" && marker.marker.pending[0]?.pushed).toBe(false);
  });

  it("skips the PR when gh is on PATH but not authenticated", async () => {
    const { root, logPath } = await mirror();
    const calls: string[][] = [];
    const exec: ExecFn = async (bin, args, opts) => {
      if (bin === "/fake/gh") {
        calls.push([...args]);
        return { code: args[0] === "auth" ? 1 : 0, stdout: "", stderr: "not logged in" };
      }
      return defaultExec(bin, args, opts);
    };
    const lines: string[] = [];
    const res = await landGateExit({
      root,
      outcome: gateOutcome(logPath),
      env: GIT_ENV,
      now: new Date("2026-10-14T04:00:00Z"),
      exec,
      which: async (b) => (b === "gh" ? "/fake/gh" : null),
      log: (l) => lines.push(l),
    });
    expect(res.pushed).toBe(true);
    expect(res.url).toBeNull();
    expect(calls).toEqual([["auth", "status"]]);
    expect(lines.join("\n")).toContain("gh is not authenticated");
  });

  it("opens a PR against the base when gh is authenticated, and records its URL", async () => {
    const { root, logPath } = await mirror();
    const calls: string[][] = [];
    const exec: ExecFn = async (bin, args, opts) => {
      if (bin === "/fake/gh") {
        calls.push([...args]);
        return args[0] === "auth"
          ? { code: 0, stdout: "", stderr: "" }
          : { code: 0, stdout: "https://example.test/o/r/pull/7\n", stderr: "" };
      }
      return defaultExec(bin, args, opts);
    };
    const res = await landGateExit({
      root,
      outcome: gateOutcome(logPath),
      env: GIT_ENV,
      now: new Date("2026-10-14T05:00:00Z"),
      exec,
      which: async (b) => (b === "gh" ? "/fake/gh" : null),
    });
    expect(res.url).toBe("https://example.test/o/r/pull/7");
    const create = calls.find((c) => c[0] === "pr");
    expect(create).toEqual(
      expect.arrayContaining(["--base", "staging", "--head", "gate-exit/20261014T050000Z"]),
    );
    const marker = await readGateExitMarker(root);
    expect(marker.kind === "ok" && marker.marker.pending[0]?.url).toBe(
      "https://example.test/o/r/pull/7",
    );
  });

  it("leaves an unreadable marker as is", async () => {
    const { root, logPath } = await mirror();
    const markerFile = path.join(root, GATE_EXIT_MARKER_RELPATH);
    await mkdir(path.dirname(markerFile), { recursive: true });
    await writeFile(markerFile, "{not json");
    const lines: string[] = [];
    const res = await landGateExit({
      root,
      outcome: gateOutcome(logPath),
      env: GIT_ENV,
      now: new Date("2026-10-14T06:00:00Z"),
      which: noForge,
      log: (l) => lines.push(l),
    });
    expect(res.markerWritten).toBe(false);
    expect(await readFile(markerFile, "utf8")).toBe("{not json");
    expect(lines.join("\n")).toContain("is unreadable");
  });
});
