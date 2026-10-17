import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Git bound to one working directory; a failure is a non-zero `code`, never a throw. */
export type LocalGitFn = (
  args: readonly string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Minimal `git` runner bound to `cwd` (argument array, no shell, never throws). */
export function gitAt(cwd: string): LocalGitFn {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        "git",
        [...args],
        {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          encoding: "utf8",
          timeout: 30_000,
        },
        (err, stdout, stderr) => {
          resolve({
            code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? err?.message ?? ""),
          });
        },
      );
    });
}

/**
 * Make sure a kit-written runtime file (`relPath`, relative to `root`) can
 * never dirty the working tree: when the repository's ignore rules miss it (an
 * install that predates the pattern, a hand-edited `.gitignore`), add it to
 * the clone-local `.git/info/exclude`, which is never committed. The line is
 * added once: a path that stays not ignored (for example because it is
 * tracked) never makes the exclude file grow. True when the path is ignored
 * afterwards; false otherwise (not a repository, a tracked file, an unwritable
 * exclude file). Never throws.
 */
export async function ensurePathIgnored(
  git: LocalGitFn,
  root: string,
  relPath: string,
): Promise<boolean> {
  try {
    const check = () => git(["check-ignore", "-q", "--", relPath]);
    const first = await check();
    if (first.code === 0) return true;
    if (first.code !== 1) return false;
    // Path of the invocation root inside the repository (empty at the top level).
    const prefix = await git(["rev-parse", "--show-prefix"]);
    const where = await git(["rev-parse", "--git-path", "info/exclude"]);
    if (prefix.code !== 0 || where.code !== 0 || !where.stdout.trim()) return false;
    const line = `/${prefix.stdout.trim()}${relPath}`;
    const exclude = path.resolve(root, where.stdout.trim());
    const current = await readFile(exclude, "utf8").catch(() => "");
    if (!current.split("\n").some((l) => l.trim() === line)) {
      await mkdir(path.dirname(exclude), { recursive: true });
      const sep = current && !current.endsWith("\n") ? "\n" : "";
      await appendFile(exclude, `${sep}${line}\n`, "utf8");
    }
    return (await check()).code === 0;
  } catch {
    return false;
  }
}
