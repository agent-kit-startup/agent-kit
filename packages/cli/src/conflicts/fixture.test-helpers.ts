import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Git isolated from the host's global/system config (hooks, signing). */
export const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Conflicts Test",
  GIT_AUTHOR_EMAIL: "conflicts-test@example.com",
  GIT_COMMITTER_NAME: "Conflicts Test",
  GIT_COMMITTER_EMAIL: "conflicts-test@example.com",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

/** Like `git` but returns the exit code instead of throwing (a conflicted merge exits 1). */
export function gitCode(cwd: string, ...args: string[]): number {
  try {
    execFileSync("git", args, { cwd, env: GIT_ENV, stdio: "ignore" });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

export async function writeFiles(root: string, files: Record<string, string | Buffer>) {
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body);
  }
}

export async function commitFiles(
  root: string,
  files: Record<string, string | Buffer>,
  message: string,
) {
  await writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

/**
 * A repository mid-merge: `main` and `feature` both changed `src/app.txt`
 * (and `two words.txt`) from the same base; `added.txt` was added on both
 * sides; `gone.txt` was deleted on `feature` and changed on `main`; `bin.dat`
 * is binary on both sides. `conflictStyle` sets merge.conflictStyle.
 */
export async function conflictedRepo(opts: { conflictStyle?: "merge" | "diff3" } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-kit-conflicts-test-"));
  const root = path.join(dir, "repo");
  await mkdir(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "merge.conflictStyle", opts.conflictStyle ?? "merge");
  await commitFiles(
    root,
    {
      "src/app.txt": "one\ntwo\nthree\nfour\nfive\n",
      "two words.txt": "alpha\nbeta\n",
      "gone.txt": "keep me\n",
      "bin.dat": Buffer.from([0, 1, 2, 3]),
    },
    "base: initial files",
  );
  git(root, "checkout", "-q", "-b", "feature");
  await commitFiles(
    root,
    {
      "src/app.txt": "one\ntwo\nTHREE from feature\nfour\nfive\n",
      "two words.txt": "alpha\nbeta feature\n",
      "added.txt": "feature version\n",
      "bin.dat": Buffer.from([0, 9, 9, 9]),
    },
    "feat: shout three\n\nFeature body line.",
  );
  git(root, "rm", "-q", "gone.txt");
  git(root, "commit", "-q", "-m", "chore: drop gone.txt");
  git(root, "checkout", "-q", "main");
  await commitFiles(
    root,
    {
      "src/app.txt": "one\ntwo\nthree on main\nfour\nfive\n",
      "two words.txt": "alpha\nbeta main\n",
      "added.txt": "main version\n",
      "gone.txt": "changed on main\n",
      "bin.dat": Buffer.from([0, 7, 7, 7]),
    },
    "fix: three on main",
  );
  const code = gitCode(root, "merge", "--no-ff", "feature");
  if (code === 0) throw new Error("fixture merge did not conflict");
  return { dir, root };
}
