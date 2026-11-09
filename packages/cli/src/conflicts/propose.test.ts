import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BackendRunResult } from "../plan-loop/backends.js";
import { claudeReviewArgs, cursorAgentReviewArgs } from "../plan-loop/backends.js";
import { runHeadlessDispatch } from "../plan-loop/dispatch.js";
import { isOutside } from "../plan-loop/gate-exit.js";
import { withContext } from "./conflicts.js";
import { conflictedRepo, GIT_ENV, git, writeFiles } from "./fixture.test-helpers.js";
import { parseConflictText } from "./markers.js";
import {
  buildProposePrompt,
  outsideHunksUnchanged,
  parseProposalReply,
  reviewProposals,
  runConflictsPropose,
  spliceResolution,
} from "./propose.js";

const BODY =
  "---\nname: resolve-conflicts\ndescription: test\n---\n\n# Command: /resolve-conflicts\n";
const SECRET = "example-conflicts-auth-value";
const ENV: NodeJS.ProcessEnv = { ...GIT_ENV, ANTHROPIC_API_KEY: SECRET };

function turn(text: string): BackendRunResult["lastResult"] {
  return { resultText: text, assistantTexts: [text] } as BackendRunResult["lastResult"];
}

function repoState(root: string) {
  return {
    status: git(root, "status", "--porcelain=v2", "--untracked-files=all"),
    index: git(root, "ls-files", "-s"),
    head: git(root, "rev-parse", "HEAD"),
    mergeHead: git(root, "rev-parse", "MERGE_HEAD"),
    worktrees: git(root, "worktree", "list", "--porcelain"),
    branches: git(root, "for-each-ref", "--format=%(refname) %(objectname)"),
    stash: git(root, "stash", "list"),
  };
}

async function repoWithCommand(opts: { conflictStyle?: "merge" | "diff3" } = {}) {
  const fx = await conflictedRepo(opts);
  await writeFiles(fx.root, { ".cursor/commands/resolve-conflicts.md": BODY });
  // Keep the command file out of the snapshot diff: ignored, like an install.
  await writeFiles(fx.root, { ".git/info/exclude": ".cursor/\n" });
  return fx;
}

const sample = ["a\n", "<<<<<<< HEAD\n", "x\n", "=======\n", "y\n", ">>>>>>> f\n", "b\n"].join("");

function parsed(text = sample) {
  const r = parseConflictText(text);
  if (!r.ok) throw new Error(r.reason);
  return { file: r.file, hunks: withContext(r.file) };
}

describe("parseProposalReply (strict schema)", () => {
  it("accepts the exact shape, with or without one code fence", () => {
    const ok = '{"proposals":[{"hunk":1,"text":"z\\n","rationale":"why"}]}';
    expect(parseProposalReply(ok)).toEqual({
      ok: true,
      proposals: [{ hunk: 1, text: "z\n", rationale: "why" }],
    });
    expect(parseProposalReply(`\`\`\`json\n${ok}\n\`\`\``).ok).toBe(true);
  });

  it("refuses prose, extra keys, a bad hunk number and wrong types", () => {
    expect(parseProposalReply("Here you go: {}").ok).toBe(false);
    expect(parseProposalReply('{"proposals":[],"note":"x"}').ok).toBe(false);
    expect(
      parseProposalReply('{"proposals":[{"hunk":1,"text":"z","rationale":"r","path":"x"}]}').ok,
    ).toBe(false);
    expect(parseProposalReply('{"proposals":[{"hunk":0,"text":"z","rationale":"r"}]}').ok).toBe(
      false,
    );
    expect(parseProposalReply('{"proposals":[{"hunk":1.5,"text":"z","rationale":"r"}]}').ok).toBe(
      false,
    );
    expect(parseProposalReply('{"proposals":[{"hunk":1,"text":3,"rationale":"r"}]}').ok).toBe(
      false,
    );
    expect(parseProposalReply('{"proposals":{}}').ok).toBe(false);
  });
});

describe("reviewProposals", () => {
  it("refuses leftover markers, a missing hunk and a repeated hunk", () => {
    const { file, hunks } = parsed();
    const out = reviewProposals(
      [
        { hunk: 1, text: "<<<<<<< HEAD\nx\n", rationale: "r" },
        { hunk: 2, text: "q\n", rationale: "r" },
        { hunk: 1, text: "x\n=======\ny\n", rationale: "r" },
      ],
      hunks,
      file,
    );
    expect(out.map((p) => p.status)).toEqual(["refused", "refused", "refused"]);
    expect(out[0]?.reason).toMatch(/conflict marker/);
    expect(out[1]?.reason).toMatch(/no hunk 2/);
    expect(out[2]?.reason).toMatch(/twice/);
    const twice = reviewProposals(
      [
        { hunk: 1, text: "x\n", rationale: "r" },
        { hunk: 1, text: "y\n", rationale: "r" },
      ],
      hunks,
      file,
    );
    expect(twice.map((p) => p.status)).toEqual(["accepted", "refused"]);
    expect(twice[1]?.reason).toMatch(/twice/);
  });

  it("refuses a proposal that rewrites the lines around its hunk", () => {
    const { file, hunks } = parsed();
    const out = reviewProposals([{ hunk: 1, text: "a\nx\ny\n", rationale: "r" }], hunks, file);
    expect(out[0]).toMatchObject({
      status: "refused",
      reason: expect.stringMatching(/outside the hunk/),
    });
    const after = reviewProposals([{ hunk: 1, text: "x\nb\n", rationale: "r" }], hunks, file);
    expect(after[0]?.reason).toMatch(/line after the hunk/);
  });

  it("applies the file's CRLF endings and the hunk's trailing newline", () => {
    const { file, hunks } = parsed(sample.replace(/\n/g, "\r\n"));
    const out = reviewProposals([{ hunk: 1, text: "x\ny", rationale: "r" }], hunks, file);
    expect(out[0]).toMatchObject({ status: "accepted", text: "x\r\ny\r\n" });
  });
});

describe("spliceResolution", () => {
  it("replaces only the hunk and leaves every other byte as it was", () => {
    const { file } = parsed(`${sample}${sample}`);
    const accepted = new Map([[2, "merged\n"]]);
    const out = spliceResolution(file, accepted);
    expect(out).toBe(`${sample}a\nmerged\nb\n`);
    expect(outsideHunksUnchanged(file, accepted, out)).toBe(true);
    expect(outsideHunksUnchanged(file, accepted, out.replace("a\n", "A\n"))).toBe(false);
  });
});

describe("the session has no tools", () => {
  it('claude runs with --tools "" and no permission bypass; cursor-agent in ask mode', () => {
    const args = claudeReviewArgs();
    const i = args.indexOf("--tools");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("");
    expect(args).not.toContain("--dangerously-skip-permissions");
    const cursor = cursorAgentReviewArgs({ workspace: "/tmp/x", prompt: "p" });
    expect(cursor.join(" ")).toMatch(/--mode ask/);
    expect(cursor).not.toContain("--force");
  });

  it("runHeadlessDispatch refuses a read-only session on other backends", async () => {
    await expect(
      runHeadlessDispatch({
        backendId: "openrouter",
        bin: "ori",
        workspace: "/tmp",
        prompt: "p",
        logPath: "/tmp/x.log",
        readOnly: true,
      }),
    ).rejects.toThrow(/review-only session runs on claude or cursor-agent only/);
  });

  it("buildProposePrompt fences the pack with the nonce", () => {
    const p = buildProposePrompt(BODY, "data", "abc123");
    expect(p).toContain("BEGIN CONFLICT PACK abc123\ndata\nEND CONFLICT PACK abc123");
    expect(p).toMatch(/you have no tools/);
  });
});

describe("runConflictsPropose", () => {
  const reply = JSON.stringify({
    proposals: [{ hunk: 1, text: "three, merged\n", rationale: "keep both intents" }],
  });

  it("runs one read-only session outside the repository, verifies, and writes nothing", async () => {
    const { root } = await repoWithCommand();
    const before = repoState(root);
    const fileBefore = await readFile(path.join(root, "src/app.txt"), "utf8");
    const seen: Array<{ readOnly?: boolean; workspace: string; files: string[]; prompt: string }> =
      [];
    const shells: Array<{ command: string; cwd: string; content: string }> = [];
    const r = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "claude",
      bin: "claude",
      env: ENV,
      verifyCommands: ["check-it"],
      dispatch: async (opts) => {
        expect(opts.render).toBeDefined();
        seen.push({
          readOnly: opts.readOnly,
          workspace: opts.workspace,
          files: await readdir(opts.workspace),
          prompt: opts.prompt,
        });
        return { exitCode: 0, lastResult: turn(reply) };
      },
      runShell: async (command, opts) => {
        shells.push({
          command,
          cwd: opts.cwd,
          content: await readFile(path.join(opts.cwd, "src/app.txt"), "utf8"),
        });
        return { code: 0, output: `ok ${SECRET}` };
      },
      log: () => undefined,
    });
    expect(r.error).toBeUndefined();
    expect(r.exitCode).toBe(0);
    // The session: read-only, an empty workspace outside the repository.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.readOnly).toBe(true);
    expect(seen[0]?.files).toEqual([]);
    expect(isOutside(root, seen[0]?.workspace ?? root)).toBe(true);
    expect(seen[0]?.prompt).toContain("THREE from feature");
    expect(seen[0]?.prompt).toContain("feat: shout three");
    expect(seen[0]?.prompt).toContain("fix: three on main");
    // The result: proposal accepted, file spliced, verification passed in a temp worktree.
    const res = r.result;
    expect(res?.proposals[0]).toMatchObject({ hunk: 1, status: "accepted" });
    expect(res?.resolvedText).toBe("one\ntwo\nthree, merged\nfour\nfive\n");
    expect(res?.verification.status).toBe("passed");
    expect(res?.verification.commands[0]?.tail).not.toContain(SECRET);
    expect(shells).toHaveLength(1);
    expect(isOutside(root, shells[0]?.cwd ?? root)).toBe(true);
    expect(shells[0]?.content).toBe("one\ntwo\nthree, merged\nfour\nfive\n");
    // The no-write guarantee.
    expect(await readFile(path.join(root, "src/app.txt"), "utf8")).toBe(fileBefore);
    expect(repoState(root)).toEqual(before);
  });

  it("refuses a bad reply and offers nothing, still writing nothing", async () => {
    const { root } = await repoWithCommand();
    const before = repoState(root);
    let ran = 0;
    const bad = JSON.stringify({
      proposals: [{ hunk: 1, text: "<<<<<<< HEAD\nthree\n", rationale: "oops" }],
    });
    const r = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "cursor-agent",
      bin: "cursor-agent",
      env: ENV,
      verifyCommands: ["check-it"],
      dispatch: async () => ({ exitCode: 0, lastResult: turn(bad) }),
      runShell: async () => {
        ran++;
        return { code: 0, output: "" };
      },
      log: () => undefined,
    });
    expect(r.exitCode).toBe(0);
    expect(r.result?.proposals[0]?.status).toBe("refused");
    expect(r.result?.resolvedText).toBeNull();
    expect(r.result?.verification.status).toBe("not-run");
    expect(ran).toBe(0);
    const prose = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "claude",
      bin: "claude",
      env: ENV,
      dispatch: async () => ({ exitCode: 0, lastResult: turn("Sure! Take theirs.") }),
      log: () => undefined,
    });
    expect(prose.result?.replyRefused).toMatch(/not one JSON object/);
    expect(prose.result?.resolvedText).toBeNull();
    expect(repoState(root)).toEqual(before);
  });

  it("reports a failed verification and keeps the repository untouched", async () => {
    const { root } = await repoWithCommand();
    const before = repoState(root);
    const r = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "claude",
      bin: "claude",
      env: ENV,
      verifyCommands: ["grep -q never src/app.txt"],
      dispatch: async () => ({ exitCode: 0, lastResult: turn(reply) }),
      log: () => undefined,
    });
    expect(r.result?.verification.status).toBe("failed");
    expect(r.result?.verification.commands[0]?.exitCode).not.toBe(0);
    expect(repoState(root)).toEqual(before);
  });

  it("runs real shell verification in the temporary worktree", async () => {
    const { root } = await repoWithCommand();
    const r = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "claude",
      bin: "claude",
      env: ENV,
      verifyCommands: ["grep -q 'three, merged' src/app.txt && test ! -e .git/MERGE_HEAD"],
      dispatch: async () => ({ exitCode: 0, lastResult: turn(reply) }),
      log: () => undefined,
    });
    expect(r.result?.verification).toMatchObject({ status: "passed" });
    expect(r.result?.verification.notes.join(" ")).toMatch(/other unresolved paths/);
  });

  it("skips verification with --no-verify and reports not-run with no configured command", async () => {
    const { root } = await repoWithCommand();
    const skipped = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "claude",
      bin: "claude",
      env: ENV,
      noVerify: true,
      dispatch: async () => ({ exitCode: 0, lastResult: turn(reply) }),
      log: () => undefined,
    });
    expect(skipped.result?.verification.status).toBe("skipped");
    const none = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "claude",
      bin: "claude",
      env: ENV,
      dispatch: async () => ({ exitCode: 0, lastResult: turn(reply) }),
      log: () => undefined,
    });
    expect(none.result?.verification.status).toBe("not-run");
  });

  it("refuses openrouter, a path that is not unmerged, and a binary or deleted path", async () => {
    const { root } = await repoWithCommand();
    const dispatch = async (): Promise<BackendRunResult> => {
      throw new Error("must not run");
    };
    const base = { root, bin: "claude", env: ENV, dispatch, log: () => undefined };
    expect(
      (await runConflictsPropose({ ...base, path: "src/app.txt", backendId: "openrouter" })).error,
    ).toMatch(/claude or cursor-agent only/);
    expect(
      (await runConflictsPropose({ ...base, path: "../etc/passwd", backendId: "claude" })).error,
    ).toMatch(/not an unmerged path/);
    expect(
      (await runConflictsPropose({ ...base, path: "bin.dat", backendId: "claude" })).error,
    ).toMatch(/binary/);
    expect(
      (await runConflictsPropose({ ...base, path: "gone.txt", backendId: "claude" })).error,
    ).toMatch(/deleted|delete/);
  });

  it("--dry-run returns the prompt with the redacted pack and starts no session", async () => {
    const { root } = await repoWithCommand();
    await writeFiles(root, {
      "src/app.txt": (await readFile(path.join(root, "src/app.txt"), "utf8")).replace(
        "four",
        `four ${SECRET}`,
      ),
    });
    const r = await runConflictsPropose({
      root,
      path: "src/app.txt",
      backendId: "claude",
      bin: "claude",
      env: ENV,
      dryRun: true,
      dispatch: async () => {
        throw new Error("must not run");
      },
      log: () => undefined,
    });
    expect(r.exitCode).toBe(0);
    expect(r.prompt).toMatch(/BEGIN CONFLICT PACK [0-9a-f]{24}/);
    expect(r.prompt).not.toContain(SECRET);
  });
});
