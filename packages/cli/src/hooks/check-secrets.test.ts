import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../../..");
const HOOK = path.join(repoRoot, ".cursor/hooks/pre-commit/check-secrets.sh");

// Built at runtime so no secret-shaped literal lands in the source (HOL plugin scan).
const GH_TOKEN = ["gh", "p_", "A".repeat(36)].join("");
const SK_KEY = ["sk", "ant", "api03", "x".repeat(20)].join("-");

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

const rooms: string[] = [];

afterEach(async () => {
  await Promise.all(rooms.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): void {
  const res = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
}

async function repo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-kit-check-secrets-"));
  rooms.push(dir);
  git(dir, "init", "-q");
  await writeFile(path.join(dir, "README.md"), "seed\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "--no-verify", "-m", "seed");
  return dir;
}

function runHook(cwd: string) {
  return spawnSync("sh", [HOOK], { cwd, env: GIT_ENV, encoding: "utf8" });
}

describe(".cursor/hooks/pre-commit/check-secrets.sh", () => {
  it("blocks a staged token shape outside the old extension allowlist", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "notes.md"), `token ${GH_TOKEN}\n`);
    git(dir, "add", "notes.md");
    const res = runHook(dir);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("Commit blocked");
    expect(res.stdout).not.toContain(GH_TOKEN);
  });

  it("blocks a staged hyphenated sk- key and the JSON key/value pattern", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "a.sh"), `KEY=${SK_KEY}\n`);
    git(dir, "add", "a.sh");
    expect(runHook(dir).status).toBe(1);

    const dir2 = await repo();
    const kv = `{ "${"pass"}word": "${"z".repeat(16)}" }\n`;
    await writeFile(path.join(dir2, "c.json"), kv);
    git(dir2, "add", "c.json");
    expect(runHook(dir2).status).toBe(1);
  });

  it("passes a clean staged change", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "ok.ts"), "export const x = 1;\n");
    git(dir, "add", "ok.ts");
    const res = runHook(dir);
    expect(res.status).toBe(0);
  });

  it("ignores a secret that is only in the working tree, not staged", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "cfg.ts"), "export const x = 1;\n");
    git(dir, "add", "cfg.ts");
    await writeFile(
      path.join(dir, "cfg.ts"),
      `export const x = 1;\nconst c = { "token": "${"q".repeat(20)}" };\n`,
    );
    expect(runHook(dir).status).toBe(0);
  });

  it("ignores a secret on a context line that the staged diff did not add", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "old.txt"), `${GH_TOKEN}\n`);
    git(dir, "add", "old.txt");
    git(dir, "commit", "-q", "--no-verify", "-m", "fixture");
    await writeFile(path.join(dir, "old.txt"), `${GH_TOKEN}\nclean line\n`);
    git(dir, "add", "old.txt");
    expect(runHook(dir).status).toBe(0);
  });

  it("still blocks a staged secret followed by 200k lines (no SIGPIPE pass)", async () => {
    const dir = await repo();
    const tail = Array.from({ length: 200_000 }, (_, i) => `line ${i}`).join("\n");
    await writeFile(path.join(dir, "big.txt"), `${GH_TOKEN}\n${tail}\n`);
    git(dir, "add", "big.txt");
    expect(runHook(dir).status).toBe(1);
  }, 60_000);

  it("scans a staged path that contains spaces", async () => {
    const dir = await repo();
    await mkdir(path.join(dir, "my dir"));
    await writeFile(path.join(dir, "my dir", "a b.ts"), `const t = "${GH_TOKEN}";\n`);
    git(dir, "add", "my dir/a b.ts");
    expect(runHook(dir).status).toBe(1);
  });

  it("ignores a diff.external driver that would hide the staged token", async () => {
    const dir = await repo();
    git(dir, "config", "diff.external", "true");
    await writeFile(path.join(dir, "a.txt"), `k ${GH_TOKEN}\n`);
    git(dir, "add", "a.txt");
    expect(runHook(dir).status).toBe(1);
  });

  it("blocks an added line that starts with '++ '", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "b.txt"), `++ ${GH_TOKEN}\n`);
    git(dir, "add", "b.txt");
    expect(runHook(dir).status).toBe(1);
  });

  it("does not flag kebab-case words that merely contain sk-", async () => {
    const dir = await repo();
    await writeFile(path.join(dir, "c.ts"), 'const job = "run-task-in-background-worker-pool";\n');
    git(dir, "add", "c.ts");
    expect(runHook(dir).status).toBe(0);
  });
});
