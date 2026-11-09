import { describe, expect, it } from "vitest";
import { defaultExec, type GitFn } from "../plan-loop/gate-exit.js";
import { listConflicts, parseUnmergedPorcelainV2 } from "./conflicts.js";
import { conflictedRepo, GIT_ENV, git } from "./fixture.test-helpers.js";

function gitFn(root: string): GitFn {
  return (args) => defaultExec("git", args, { cwd: root, env: GIT_ENV });
}

function repoState(root: string) {
  return {
    status: git(root, "status", "--porcelain=v2", "--untracked-files=all"),
    index: git(root, "ls-files", "-s", "--stage"),
    head: git(root, "rev-parse", "HEAD"),
    mergeHead: git(root, "rev-parse", "MERGE_HEAD"),
    worktrees: git(root, "worktree", "list", "--porcelain"),
    diff: git(root, "diff"),
  };
}

describe("parseUnmergedPorcelainV2", () => {
  it("reads u entries with stage ids, paths with spaces, and skips rename records", () => {
    const z = "0".repeat(40);
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const c = "c".repeat(40);
    const out = [
      `2 R. N... 100644 100644 100644 ${a} ${a} R100 new name.txt`,
      "old name.txt",
      `u UU N... 100644 100644 100644 100644 ${a} ${b} ${c} dir/two words.txt`,
      `u AA N... 000000 100644 100644 100644 ${z} ${b} ${c} added.txt`,
      `1 .M N... 100644 100644 100644 ${a} ${a} plain.txt`,
      "",
    ].join("\u0000");
    expect(parseUnmergedPorcelainV2(out)).toEqual([
      { path: "dir/two words.txt", xy: "UU", stages: { base: a, ours: b, theirs: c } },
      { path: "added.txt", xy: "AA", stages: { base: null, ours: b, theirs: c } },
    ]);
  });
});

describe("listConflicts", () => {
  it("lists every unmerged path; two-way hunks get their base from the index stages", async () => {
    const { root } = await conflictedRepo();
    const before = repoState(root);
    const r = await listConflicts({ git: gitFn(root), exec: defaultExec, repo: root });
    expect(typeof r).not.toBe("string");
    if (typeof r === "string") return;
    expect(r.operation).toBe("merge");
    expect(r.ours?.subject).toBe("fix: three on main");
    expect(r.theirs?.subject).toBe("chore: drop gone.txt");
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(
      ["added.txt", "bin.dat", "gone.txt", "src/app.txt", "two words.txt"].sort(),
    );
    const app = byPath["src/app.txt"];
    expect(app).toMatchObject({ kind: "text", xy: "UU", baseSource: "index" });
    expect(app?.hunks).toHaveLength(1);
    expect(app?.hunks[0]).toMatchObject({
      ours: "three on main\n",
      base: "three\n",
      theirs: "THREE from feature\n",
      contextBefore: "one\ntwo\n",
      contextAfter: "four\nfive\n",
    });
    expect(byPath["two words.txt"]?.hunks[0]?.base).toBe("beta\n");
    expect(byPath["added.txt"]).toMatchObject({ xy: "AA", kind: "text", baseSource: "none" });
    expect(byPath["added.txt"]?.hunks[0]?.base).toBeNull();
    expect(byPath["gone.txt"]).toMatchObject({ kind: "deleted", hunks: [] });
    expect(byPath["bin.dat"]?.kind).toBe("binary");
    // Read-only: working tree, index, HEAD, MERGE_HEAD and worktrees unchanged.
    expect(repoState(root)).toEqual(before);
  });

  it("takes the base from diff3 markers when the merge wrote them", async () => {
    const { root } = await conflictedRepo({ conflictStyle: "diff3" });
    const r = await listConflicts({ git: gitFn(root), exec: defaultExec, repo: root });
    if (typeof r === "string") throw new Error(r);
    const app = r.files.find((f) => f.path === "src/app.txt");
    expect(app?.baseSource).toBe("markers");
    expect(app?.hunks[0]?.base).toBe("three\n");
  });

  it("returns no files outside a merge", async () => {
    const { root } = await conflictedRepo();
    git(root, "merge", "--abort");
    const r = await listConflicts({ git: gitFn(root), exec: defaultExec, repo: root });
    if (typeof r === "string") throw new Error(r);
    expect(r.files).toEqual([]);
    expect(r.operation).toBeNull();
  });
});
