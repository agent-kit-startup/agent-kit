import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensurePathIgnored, gitAt } from "./git-local-exclude.js";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Exclude Test",
  GIT_AUTHOR_EMAIL: "exclude-test@example.com",
  GIT_COMMITTER_NAME: "Exclude Test",
  GIT_COMMITTER_EMAIL: "exclude-test@example.com",
};

const REL = ".cursor/context/state.json";

async function repo(): Promise<{ root: string; git: (...args: string[]) => string }> {
  const root = await mkdtemp(path.join(tmpdir(), "ak-local-exclude-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env: GIT_ENV, encoding: "utf8" }).trim();
  git("init", "-q");
  await mkdir(path.join(root, ".cursor", "context"), { recursive: true });
  return { root, git };
}

const excludeLines = async (root: string) =>
  (await readFile(path.join(root, ".git", "info", "exclude"), "utf8").catch(() => ""))
    .split("\n")
    .filter((l) => l === `/${REL}`);

describe("ensurePathIgnored", () => {
  it("already ignored: true, exclude untouched", async () => {
    const { root } = await repo();
    await writeFile(path.join(root, ".gitignore"), `${REL}\n`);
    expect(await ensurePathIgnored(gitAt(root), root, REL)).toBe(true);
    expect(await excludeLines(root)).toHaveLength(0);
  });

  it("not ignored: adds one exclude line, then the untracked file stays out of status", async () => {
    const { root, git } = await repo();
    expect(await ensurePathIgnored(gitAt(root), root, REL)).toBe(true);
    expect(await ensurePathIgnored(gitAt(root), root, REL)).toBe(true);
    await writeFile(path.join(root, REL), "{}\n");
    expect(git("status", "--porcelain")).toBe("");
    expect(await excludeLines(root)).toHaveLength(1);
  });

  it("a tracked file: false, and repeated calls never grow the exclude file", async () => {
    const { root, git } = await repo();
    await writeFile(path.join(root, REL), "{}\n");
    git("add", "--", REL);
    git("commit", "-q", "-m", "track");
    expect(await ensurePathIgnored(gitAt(root), root, REL)).toBe(false);
    expect(await ensurePathIgnored(gitAt(root), root, REL)).toBe(false);
    expect(await excludeLines(root)).toHaveLength(1);
  });

  it("outside a repository: false, never throws", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-local-exclude-norepo-"));
    expect(await ensurePathIgnored(gitAt(root), root, REL)).toBe(false);
  });
});
