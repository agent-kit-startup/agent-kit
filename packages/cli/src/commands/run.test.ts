import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayPath, executeRun } from "./run.js";

const whichCursor: (bin: string) => Promise<string | null> = async (bin) =>
  bin === "cursor-agent" ? "/usr/local/bin/cursor-agent" : null;

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-run-cmd-"));
  const dir = path.join(root, ".cursor", "commands");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "backlog-add.md"),
    "---\nname: backlog-add\n---\n\nEnqueue a plan.\n",
    "utf8",
  );
  return root;
}

describe("executeRun", () => {
  it("dry-run prints backend and L0 prompt without spawning", async () => {
    const root = await fixtureRoot();
    const result = await executeRun({
      slash: "backlog-add",
      cwd: root,
      backend: "auto",
      dryRun: true,
      maxTicks: 10,
      sleepSeconds: 5,
      whichFn: whichCursor,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--dry-run: no agent will be started.");
    expect(result.stdout).toContain("Slash: backlog-add");
    expect(result.stdout).toContain("Backend: cursor-agent (/usr/local/bin/cursor-agent)");
    // Paths in tips are workspace-relative, never absolute (visual-kit ADR point 4).
    expect(result.stdout).toContain(
      `Command file: ${path.join(".cursor", "commands", "backlog-add.md")}`,
    );
    expect(result.stdout).not.toContain(root);
    expect(result.stdout).toContain("Enqueue a plan.");
    expect(result.stdout).toContain("numbered-list HITL");
  });

  it("collapses a home-directory binary path to ~ in tips", async () => {
    const home = os.homedir();
    const root = await fixtureRoot();
    const result = await executeRun({
      slash: "backlog-add",
      cwd: root,
      backend: "claude",
      dryRun: true,
      maxTicks: 10,
      sleepSeconds: 5,
      whichFn: async (bin) =>
        bin === "claude" ? path.join(home, ".local", "bin", "claude") : null,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `Backend: claude (~${path.sep}${path.join(".local", "bin", "claude")})`,
    );
    expect(result.stdout).not.toContain(home);

    expect(displayPath(path.join(home, ".claude", "local", "claude"), home)).toBe(
      `~${path.sep}${path.join(".claude", "local", "claude")}`,
    );
    expect(displayPath("/usr/bin/claude", home)).toBe("/usr/bin/claude");
    expect(displayPath(home, home)).toBe("~");
    expect(displayPath(`${home}-other/claude`, home)).toBe(`${home}-other/claude`);
  });

  it("fails with an install hint when no binary is on PATH", async () => {
    const root = await fixtureRoot();
    const result = await executeRun({
      slash: "backlog-add",
      cwd: root,
      backend: "auto",
      dryRun: true,
      maxTicks: 10,
      sleepSeconds: 5,
      whichFn: async () => null,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("No agent CLI found on PATH");
    expect(result.error).toContain("cursor-agent");
  });

  it("refuses git-prod even when a binary exists", async () => {
    const result = await executeRun({
      slash: "/git-prod",
      cwd: "/tmp",
      backend: "auto",
      dryRun: true,
      maxTicks: 10,
      sleepSeconds: 5,
      whichFn: whichCursor,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("operator-gated");
    expect(result.error).toContain("Never auto /git-prod");
  });

  it("aliases run-plan dry-run on whichever backend detect resolves, claude included", async () => {
    const ok = await executeRun({
      slash: "run-plan",
      cwd: "/tmp",
      backend: "auto",
      dryRun: true,
      maxTicks: 10,
      sleepSeconds: 5,
      whichFn: whichCursor,
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("alias agent-kit run-plan");

    const claude = await executeRun({
      slash: "run-plan",
      cwd: "/tmp",
      backend: "claude",
      dryRun: true,
      maxTicks: 10,
      sleepSeconds: 5,
      whichFn: async (bin) => (bin === "claude" ? "/usr/bin/claude" : null),
    });
    expect(claude.exitCode).toBe(0);
    expect(claude.error).toBeUndefined();
    expect(claude.stdout).toContain("alias agent-kit run-plan (backend claude at /usr/bin/claude)");
  });
});
