import { type GitFn, gateExitNotePath } from "./gate-exit.js";

/**
 * Squash- and rebase-aware "is this branch already in the base" checks,
 * shared by Ground Control (a ticket is merged) and the review job (a branch
 * has nothing left to review). Both start with the ancestor test and then
 * compare blob ids: a squash or rebase merge rewrites commits but carries the
 * branch's file contents byte for byte.
 */

/** `ref` is an ancestor of `baseRef` (merge or fast-forward). */
export async function isAncestor(git: GitFn, ref: string, baseRef: string): Promise<boolean> {
  return (await git(["merge-base", "--is-ancestor", ref, baseRef])).code === 0;
}

/** Object id of `spec` (`<ref>:<path>`), or null when it does not resolve. */
export async function blobId(git: GitFn, spec: string): Promise<string | null> {
  const r = await git(["rev-parse", "--verify", "--quiet", spec]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/**
 * Merged into the base: the branch tip is an ancestor of the base (merge or
 * fast-forward), or the base carries the branch's note byte for byte
 * (squash merge, rebase merge).
 */
export async function isTicketMerged(
  git: GitFn,
  branchRef: string,
  baseRef: string,
  stamp: string,
): Promise<boolean> {
  if (await isAncestor(git, branchRef, baseRef)) return true;
  const note = gateExitNotePath(stamp);
  const onBranch = await blobId(git, `${branchRef}:${note}`);
  return onBranch !== null && onBranch === (await blobId(git, `${baseRef}:${note}`));
}

/** Most changed paths compared one by one; a larger branch is treated as not merged. */
export const BRANCH_IN_BASE_MAX_PATHS = 500;

const ZERO_OID = /^0+$/;

/**
 * `-z --raw --no-abbrev` output (`:<modes> <old> <new> <status>` NUL `<path>`
 * NUL, paths unquoted) -> `<new blob>\t<path>` pairs; a deletion's blob is
 * `deleted`.
 */
function parseRawZ(stdout: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const tokens = stdout.split("\0");
  for (let i = 0; i < tokens.length; i += 1) {
    const meta = (tokens[i] ?? "").replace(/^\n+/, "");
    if (!meta.startsWith(":")) continue;
    const file = tokens[i + 1] ?? "";
    i += 1;
    const blob = meta.slice(1).split(" ")[3];
    if (blob && file) out.push([file, ZERO_OID.test(blob) ? "deleted" : blob]);
  }
  return out;
}

/**
 * The branch's changes are already in the base: the tip is an ancestor of the
 * base, or every path the branch changes since the merge base (within
 * `pathspec`) has, in some base commit after that merge base, exactly the
 * branch tip's content (same blob id, or deleted on both). That is what a
 * squash or rebase merge leaves behind, even after the base changed the same
 * files again. A branch with no changed path, more than
 * `BRANCH_IN_BASE_MAX_PATHS` paths, or any git failure counts as not in the
 * base (the caller then reviews it: fail toward visibility).
 */
export async function isBranchInBase(
  git: GitFn,
  branchRef: string,
  baseRef: string,
  pathspec: readonly string[] = [],
): Promise<boolean> {
  if (await isAncestor(git, branchRef, baseRef)) return true;
  const mb = await git(["merge-base", baseRef, branchRef]);
  const mergeBase = mb.stdout.trim();
  if (mb.code !== 0 || !mergeBase) return false;
  const changed = await git([
    "diff",
    "-z",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    mergeBase,
    branchRef,
    ...(pathspec.length ? ["--", ...pathspec] : []),
  ]);
  if (changed.code !== 0) return false;
  const onBranch = new Map(parseRawZ(changed.stdout));
  if (onBranch.size === 0 || onBranch.size > BRANCH_IN_BASE_MAX_PATHS) return false;
  const history = await git([
    "log",
    "-z",
    "--format=",
    "--raw",
    "--no-abbrev",
    "--no-renames",
    `${mergeBase}..${baseRef}`,
    "--",
    ...[...onBranch.keys()].map((file) => `:(literal)${file}`),
  ]);
  if (history.code !== 0) return false;
  const seen = new Set(parseRawZ(history.stdout).map(([file, blob]) => `${blob}\t${file}`));
  for (const [file, blob] of onBranch) {
    if (!seen.has(`${blob}\t${file}`)) return false;
  }
  return true;
}
