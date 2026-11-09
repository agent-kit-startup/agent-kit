/**
 * Read-only view of a repository's merge conflicts for `agent-kit conflicts`
 * (ADR 2026-10-23_git-cicd-tab-read-in-mc-act-in-colony.md, amend 2026-11-07,
 * points 2 and 6). Nothing here writes the working tree, the index or a ref:
 * stage blobs are copied to a temporary directory outside the repository and
 * rendered there with `git merge-file -p` (stdout only).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type ExecFn, type GitFn, isOutside } from "../plan-loop/gate-exit.js";
import { type ConflictHunk, type ParsedConflictFile, parseConflictText } from "./markers.js";

export const CONFLICTS_SCHEMA = 1;
/** Commit message bytes kept per side. */
export const CONFLICT_MESSAGE_MAX = 4000;
/** Commits listed per side that touch the conflicted path. */
export const CONFLICT_PATH_COMMITS_MAX = 10;
/** Context lines shown before and after each hunk. */
export const CONFLICT_CONTEXT_LINES = 3;

export type ConflictOperation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface UnmergedEntry {
  path: string;
  /** Porcelain v2 XY code: UU, AA, DU, UD, AU, UA, DD. */
  xy: string;
  /** Blob ids of index stages 1 (base), 2 (ours) and 3 (theirs); absent stages are null. */
  stages: { base: string | null; ours: string | null; theirs: string | null };
}

export interface ConflictHunkReport extends ConflictHunk {
  /** Up to CONFLICT_CONTEXT_LINES lines before and after the hunk. */
  contextBefore: string;
  contextAfter: string;
}

export interface ConflictFileReport {
  path: string;
  xy: string;
  /**
   * text: a parsed text file (`hunks` may be empty when the markers are gone);
   * deleted: one side deleted the file (no markers to resolve hunk by hunk);
   * binary / unparsable: refused, resolve by hand.
   */
  kind: "text" | "deleted" | "binary" | "unparsable";
  /** Where the hunks' base came from: the diff3 markers, the index stages, or nowhere. */
  baseSource: "markers" | "index" | "none" | null;
  hunks: ConflictHunkReport[];
  reason?: string;
}

export interface ConflictSide {
  ref: string;
  sha: string;
  subject: string;
  /** Full message, at most CONFLICT_MESSAGE_MAX characters. */
  message: string;
}

export interface ConflictSides {
  operation: ConflictOperation | null;
  ours: ConflictSide | null;
  theirs: ConflictSide | null;
  mergeBase: string | null;
}

export interface ConflictsListing {
  schema: typeof CONFLICTS_SCHEMA;
  root: string;
  operation: ConflictOperation | null;
  ours: ConflictSide | null;
  theirs: ConflictSide | null;
  files: ConflictFileReport[];
}

/** Unmerged (`u`) entries of `git status --porcelain=v2 -z`. */
export function parseUnmergedPorcelainV2(stdout: string): UnmergedEntry[] {
  const fields = stdout.split("\u0000");
  const out: UnmergedEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i] ?? "";
    if (f.startsWith("2 ")) {
      i++; // a rename record carries the original path in the next field
      continue;
    }
    if (!f.startsWith("u ")) continue;
    // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
    const parts = f.split(" ");
    if (parts.length < 11) continue;
    const [, xy, , m1, m2, m3, , h1, h2, h3] = parts;
    const stage = (mode: string | undefined, hash: string | undefined) =>
      mode && mode !== "000000" && hash && !/^0+$/.test(hash) ? hash : null;
    out.push({
      path: parts.slice(10).join(" "),
      xy: xy ?? "",
      stages: { base: stage(m1, h1), ours: stage(m2, h2), theirs: stage(m3, h3) },
    });
  }
  return out;
}

export async function listUnmerged(git: GitFn): Promise<UnmergedEntry[] | string> {
  const r = await git(["status", "--porcelain=v2", "-z", "--untracked-files=no"]);
  if (r.code !== 0) return `git status failed: ${r.stderr.trim().split("\n")[0] ?? ""}`;
  return parseUnmergedPorcelainV2(r.stdout);
}

async function revParse(git: GitFn, ref: string): Promise<string | null> {
  const r = await git(["rev-parse", "-q", "--verify", `${ref}^{commit}`]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

async function readSide(git: GitFn, ref: string, sha: string): Promise<ConflictSide> {
  const r = await git(["log", "-1", "--no-color", "--format=%s%x00%B", sha]);
  const [subject = "", body = ""] = r.code === 0 ? r.stdout.split("\u0000") : ["", ""];
  return {
    ref,
    sha,
    subject: subject.trim(),
    message: body.trim().slice(0, CONFLICT_MESSAGE_MAX),
  };
}

/** The operation in progress and both sides' commits (HEAD is "ours"). */
export async function readConflictSides(git: GitFn): Promise<ConflictSides> {
  const head = await revParse(git, "HEAD");
  const candidates: Array<[ConflictOperation, string]> = [
    ["merge", "MERGE_HEAD"],
    ["rebase", "REBASE_HEAD"],
    ["cherry-pick", "CHERRY_PICK_HEAD"],
    ["revert", "REVERT_HEAD"],
  ];
  let operation: ConflictOperation | null = null;
  let theirs: ConflictSide | null = null;
  for (const [op, ref] of candidates) {
    const sha = await revParse(git, ref);
    if (sha) {
      operation = op;
      theirs = await readSide(git, ref, sha);
      break;
    }
  }
  const ours = head ? await readSide(git, "HEAD", head) : null;
  let mergeBase: string | null = null;
  if (head && theirs) {
    const mb = await git(["merge-base", head, theirs.sha]);
    mergeBase = mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : null;
  }
  return { operation, ours, theirs, mergeBase };
}

/** `<short> <subject>` of commits from the merge base to `sha` that touch `rel`. */
export async function pathCommits(
  git: GitFn,
  mergeBase: string | null,
  sha: string,
  rel: string,
): Promise<string[]> {
  const range = mergeBase ? `${mergeBase}..${sha}` : sha;
  const r = await git([
    "log",
    "--no-color",
    "--format=%h %s",
    `--max-count=${CONFLICT_PATH_COMMITS_MAX}`,
    range,
    "--",
    rel,
  ]);
  return r.code === 0 ? r.stdout.split("\n").filter((l) => l.trim()) : [];
}

function lastLines(text: string, n: number): string {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return lines.slice(-n).join("");
}

function firstLines(text: string, n: number): string {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return lines.slice(0, n).join("");
}

export function withContext(file: ParsedConflictFile, n = CONFLICT_CONTEXT_LINES) {
  return file.segments.flatMap((seg, i) => {
    if (seg.kind !== "hunk") return [];
    const before = file.segments[i - 1];
    const after = file.segments[i + 1];
    return [
      {
        ...seg.hunk,
        contextBefore: before?.kind === "text" ? lastLines(before.text, n) : "",
        contextAfter: after?.kind === "text" ? firstLines(after.text, n) : "",
      },
    ];
  });
}

/**
 * Fill the base of two-way hunks from the index stages: the three blobs are
 * written to a temporary directory outside the repository and rendered with
 * `git merge-file -p --zdiff3` (then `--diff3`), stdout only. The bases are
 * taken only when the rendition has the same hunks, with the same ours and
 * theirs text, in the same order as the working file.
 */
export async function fillBaseFromIndex(opts: {
  git: GitFn;
  exec: ExecFn;
  repo: string;
  entry: UnmergedEntry;
  hunks: ConflictHunkReport[];
  tmpRoot?: string;
}): Promise<{ ok: true; hunks: ConflictHunkReport[] } | { ok: false; reason: string }> {
  const { base, ours, theirs } = opts.entry.stages;
  if (!base) return { ok: false, reason: "no base in the index (both sides added the file)" };
  if (!ours || !theirs) return { ok: false, reason: "one side has no index stage" };
  const tmp = await mkdtemp(path.join(opts.tmpRoot ?? tmpdir(), "agent-kit-conflicts-"));
  try {
    if (!isOutside(opts.repo, tmp)) {
      return { ok: false, reason: "the temporary directory resolves inside the repository" };
    }
    const files: Record<string, string> = { ours, base, theirs };
    for (const [name, blob] of Object.entries(files)) {
      const r = await opts.git(["cat-file", "blob", blob]);
      if (r.code !== 0) return { ok: false, reason: `cannot read the ${name} stage` };
      await writeFile(path.join(tmp, name), r.stdout, "utf8");
    }
    for (const style of ["--zdiff3", "--diff3"]) {
      const r = await opts.exec(
        "git",
        [
          "merge-file",
          "-p",
          style,
          "-L",
          "ours",
          "-L",
          "base",
          "-L",
          "theirs",
          "ours",
          "base",
          "theirs",
        ],
        { cwd: tmp },
      );
      // Exit code = number of conflicts (>= 0); a negative or signal code is an error.
      if (r.code < 0 || r.code > 127) continue;
      const parsed = parseConflictText(r.stdout);
      if (!parsed.ok || parsed.file.hunks.length !== opts.hunks.length) continue;
      const matches = parsed.file.hunks.every(
        (h, i) => h.ours === opts.hunks[i]?.ours && h.theirs === opts.hunks[i]?.theirs,
      );
      if (!matches) continue;
      return {
        ok: true,
        hunks: opts.hunks.map((h, i) => ({
          ...h,
          base: parsed.file.hunks[i]?.base ?? "",
          baseLabel: "index stage 1",
        })),
      };
    }
    return { ok: false, reason: "the working file no longer matches the index stages" };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

const DELETE_CODES = new Set(["DU", "UD", "DD"]);

export async function readConflictFile(opts: {
  git: GitFn;
  exec: ExecFn;
  repo: string;
  entry: UnmergedEntry;
  tmpRoot?: string;
}): Promise<{
  report: ConflictFileReport;
  parsed: ParsedConflictFile | null;
  text: string | null;
}> {
  const { entry } = opts;
  const base = { path: entry.path, xy: entry.xy };
  let buf: Buffer;
  try {
    buf = await readFile(path.join(opts.repo, entry.path));
  } catch {
    return {
      report: {
        ...base,
        kind: "deleted",
        baseSource: null,
        hunks: [],
        reason: "the file is absent from the working tree (deleted on one side)",
      },
      parsed: null,
      text: null,
    };
  }
  if (DELETE_CODES.has(entry.xy)) {
    return {
      report: {
        ...base,
        kind: "deleted",
        baseSource: null,
        hunks: [],
        reason: "one side deleted the file and the other changed it; keep or delete it by hand",
      },
      parsed: null,
      text: null,
    };
  }
  if (buf.includes(0)) {
    return {
      report: {
        ...base,
        kind: "binary",
        baseSource: null,
        hunks: [],
        reason: "binary file; resolve it by hand",
      },
      parsed: null,
      text: null,
    };
  }
  const text = buf.toString("utf8");
  const parsed = parseConflictText(text);
  if (!parsed.ok) {
    return {
      report: { ...base, kind: "unparsable", baseSource: null, hunks: [], reason: parsed.reason },
      parsed: null,
      text,
    };
  }
  let hunks = withContext(parsed.file);
  let baseSource: ConflictFileReport["baseSource"] = hunks.length === 0 ? null : "markers";
  let reason: string | undefined;
  if (hunks.some((h) => h.base === null)) {
    const filled = await fillBaseFromIndex({ ...opts, hunks });
    if (filled.ok) {
      hunks = filled.hunks;
      baseSource = "index";
    } else {
      baseSource = "none";
      reason = `no base for the two-way hunks: ${filled.reason}`;
    }
  }
  return {
    report: { ...base, kind: "text", baseSource, hunks, ...(reason ? { reason } : {}) },
    parsed: { ...parsed.file, hunks },
    text,
  };
}

/** `agent-kit conflicts`: every unmerged path, parsed into hunks. Read-only. */
export async function listConflicts(opts: {
  git: GitFn;
  exec: ExecFn;
  repo: string;
  tmpRoot?: string;
}): Promise<ConflictsListing | string> {
  const entries = await listUnmerged(opts.git);
  if (typeof entries === "string") return entries;
  const sides = await readConflictSides(opts.git);
  const files: ConflictFileReport[] = [];
  for (const entry of entries) {
    files.push((await readConflictFile({ ...opts, entry })).report);
  }
  return {
    schema: CONFLICTS_SCHEMA,
    root: opts.repo,
    operation: sides.operation,
    ours: sides.ours,
    theirs: sides.theirs,
    files,
  };
}
