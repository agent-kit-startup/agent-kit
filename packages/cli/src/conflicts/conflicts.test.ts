import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultExec, type GitFn } from "../plan-loop/gate-exit.js";
import { alignBases, listConflicts, parseUnmergedPorcelainV2 } from "./conflicts.js";
import { coalescedRepo, conflictedRepo, GIT_ENV, git } from "./fixture.test-helpers.js";
import { parseConflictText } from "./markers.js";

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

describe("coalesced hunks", () => {
  it("keeps the base when git folds two nearby conflicts into one hunk", async () => {
    const { root } = await coalescedRepo();
    const working = await readFile(path.join(root, "app.conf"), "utf8");
    // The fixture really is the folded shape: one two-way hunk carrying the blank line.
    expect(working.match(/^<<<<<<< /gm)).toHaveLength(1);
    const before = repoState(root);
    const r = await listConflicts({ git: gitFn(root), exec: defaultExec, repo: root });
    if (typeof r === "string") throw new Error(r);
    const conf = r.files.find((f) => f.path === "app.conf");
    expect(conf).toMatchObject({ kind: "text", baseSource: "index" });
    expect(conf?.reason).toBeUndefined();
    expect(conf?.hunks).toHaveLength(1);
    expect(conf?.hunks[0]).toMatchObject({
      ours: "port = 7070\n\nmode = test\n",
      base: "port = 8080\n\nmode = dev\n",
      theirs: "port = 9090\n\nmode = prod\n",
      baseLabel: "index stage 1",
    });
    expect(repoState(root)).toEqual(before);
  });

  it("still reports no base when the working hunk was edited", async () => {
    const { root } = await coalescedRepo();
    const file = path.join(root, "app.conf");
    await writeFile(file, (await readFile(file, "utf8")).replace("mode = test", "mode = edited"));
    const r = await listConflicts({ git: gitFn(root), exec: defaultExec, repo: root });
    if (typeof r === "string") throw new Error(r);
    const conf = r.files.find((f) => f.path === "app.conf");
    expect(conf).toMatchObject({ kind: "text", baseSource: "none" });
    expect(conf?.reason).toMatch(/no longer matches the index stages/);
    expect(conf?.hunks[0]?.base).toBeNull();
  });
});

describe("alignBases", () => {
  const rendition = (text: string) => {
    const p = parseConflictText(text);
    if (!p.ok) throw new Error(p.reason);
    return p.file;
  };
  const hunks = (text: string) => rendition(text).hunks;
  const three = [
    "a\n",
    "<<<<<<< ours\no1\n||||||| base\nb1\n=======\nt1\n>>>>>>> theirs\n",
    "-\n",
    "<<<<<<< ours\no2\n||||||| base\nb2\n=======\nt2\n>>>>>>> theirs\n",
    "z\n",
    "<<<<<<< ours\no3\n||||||| base\nb3\n=======\nt3\n>>>>>>> theirs\n",
    "end\n",
  ].join("");

  it("matches one-to-one hunks", () => {
    const w = hunks(three.replace(/\|\|\|\|\|\|\| base\nb\d\n/g, ""));
    expect(alignBases(w, rendition(three))).toEqual(["b1\n", "b2\n", "b3\n"]);
  });

  it("joins a run of rendition hunks with the text between them", () => {
    const w = hunks(
      "a\n<<<<<<< HEAD\no1\n-\no2\n=======\nt1\n-\nt2\n>>>>>>> side\nz\n<<<<<<< HEAD\no3\n=======\nt3\n>>>>>>> side\nend\n",
    );
    expect(alignBases(w, rendition(three))).toEqual(["b1\n-\nb2\n", "b3\n"]);
  });

  it("refuses when a rendition hunk is left over, a side differs, or the run ends early", () => {
    const folded = (o: string, t: string) =>
      hunks(`a\n<<<<<<< HEAD\n${o}=======\n${t}>>>>>>> side\nend\n`);
    // Only the first two folded: the third rendition hunk is never used.
    expect(alignBases(folded("o1\n-\no2\n", "t1\n-\nt2\n"), rendition(three))).toBeNull();
    // Theirs edited inside the fold.
    expect(
      alignBases(folded("o1\n-\no2\nz\no3\n", "t1\n-\nX\nz\nt3\n"), rendition(three)),
    ).toBeNull();
    // More than the rendition holds.
    expect(
      alignBases(
        folded("o1\n-\no2\nz\no3\nend\no4\n", "t1\n-\nt2\nz\nt3\nend\nt4\n"),
        rendition(three),
      ),
    ).toBeNull();
    // The whole file folded: every hunk used.
    expect(
      alignBases(folded("o1\n-\no2\nz\no3\n", "t1\n-\nt2\nz\nt3\n"), rendition(three)),
    ).toEqual(["b1\n-\nb2\nz\nb3\n"]);
  });
});
