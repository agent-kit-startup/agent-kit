import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assessGitHooksInstallDrift, assessHooksHealth } from "./hooks-health.js";

const ADAPTERS = [
  "session-start.sh",
  "pre-compact.sh",
  "guard-shell.sh",
  "after-edit-schema.sh",
  "secrets-prompt.sh",
] as const;

async function writeWiredHooks(
  root: string,
  opts?: { executable?: boolean; withAdapters?: boolean },
) {
  const agent = path.join(root, ".cursor", "hooks", "agent");
  await mkdir(agent, { recursive: true });
  await writeFile(
    path.join(root, ".cursor", "hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        sessionStart: [{ command: ".cursor/hooks/agent/session-start.sh" }],
        preCompact: [{ command: ".cursor/hooks/agent/pre-compact.sh" }],
        beforeShellExecution: [{ command: ".cursor/hooks/agent/guard-shell.sh" }],
        afterFileEdit: [{ command: ".cursor/hooks/agent/after-edit-schema.sh" }],
        beforeSubmitPrompt: [{ command: ".cursor/hooks/agent/secrets-prompt.sh" }],
      },
    }),
    "utf8",
  );
  await writeFile(path.join(agent, "resolve-agent-kit.sh"), "#!/bin/sh\n", "utf8");
  if (opts?.withAdapters !== false) {
    for (const name of ADAPTERS) {
      await writeFile(path.join(agent, name), "#!/bin/sh\n", "utf8");
    }
  }
  if (opts?.executable !== false) {
    await chmod(path.join(agent, "resolve-agent-kit.sh"), 0o755);
    if (opts?.withAdapters !== false) {
      for (const name of ADAPTERS) {
        await chmod(path.join(agent, name), 0o755);
      }
    }
  }
  const bin = path.join(root, "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, "agent-kit"), "#!/bin/sh\n", "utf8");
  await chmod(path.join(bin, "agent-kit"), 0o755);
}

describe("assessHooksHealth", () => {
  it("reports missing when hooks.json absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("missing");
    expect(report.advisories).toEqual([]);
  });

  it("reports active for full Node adapter wiring", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    await writeWiredHooks(root);
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("active");
    expect(report.reasons).toEqual([]);
    expect(report.advisories).toEqual([]);
  });

  it("degrades when adapters are missing on disk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    await writeWiredHooks(root, { withAdapters: false });
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("degraded");
    expect(report.reasons.some((r) => r.includes("missing adapter"))).toBe(true);
  });

  it("degrades when adapters are not executable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    await writeWiredHooks(root, { executable: false });
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("degraded");
    expect(report.reasons.some((r) => r.includes("not executable"))).toBe(true);
  });

  it("degrades when CLI does not resolve", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    const agent = path.join(root, ".cursor", "hooks", "agent");
    await mkdir(agent, { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ command: ".cursor/hooks/agent/session-start.sh" }],
          preCompact: [{ command: ".cursor/hooks/agent/pre-compact.sh" }],
          beforeShellExecution: [{ command: ".cursor/hooks/agent/guard-shell.sh" }],
          afterFileEdit: [{ command: ".cursor/hooks/agent/after-edit-schema.sh" }],
          beforeSubmitPrompt: [{ command: ".cursor/hooks/agent/secrets-prompt.sh" }],
        },
      }),
      "utf8",
    );
    await writeFile(path.join(agent, "resolve-agent-kit.sh"), "#!/bin/sh\n", "utf8");
    await chmod(path.join(agent, "resolve-agent-kit.sh"), 0o755);
    for (const name of ADAPTERS) {
      await writeFile(path.join(agent, name), "#!/bin/sh\n", "utf8");
      await chmod(path.join(agent, name), 0o755);
    }
    // No local bin/dist; clear PATH so `which agent-kit` cannot hit the host CLI.
    const prevPath = process.env.PATH;
    process.env.PATH = "/nonexistent-ak-path";
    try {
      const report = await assessHooksHealth(root);
      expect(report.status).toBe("degraded");
      expect(report.reasons.some((r) => r.includes("CLI not resolvable"))).toBe(true);
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("degrades when stop is present", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    await writeWiredHooks(root);
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const parsed = JSON.parse(await readFile(hooksPath, "utf8"));
    parsed.hooks.stop = [{ command: "echo no" }];
    await writeFile(hooksPath, JSON.stringify(parsed), "utf8");
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("degraded");
    expect(report.reasons.some((r) => r.includes("stop"))).toBe(true);
  });

  it("keeps status active when only git-hooks install drift advisories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    await writeWiredHooks(root);
    await mkdir(path.join(root, "git-hooks"), { recursive: true });
    await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
    await writeFile(path.join(root, "git-hooks", "pre-push"), "#!/bin/sh\n# canonical\n", "utf8");
    await writeFile(path.join(root, ".git", "hooks", "pre-push"), "#!/bin/sh\n# stale\n", "utf8");
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("active");
    expect(report.reasons).toEqual([]);
    expect(
      report.advisories.some((a) => a.includes("git-hooks drift") && a.includes("pre-push")),
    ).toBe(true);
    expect(report.advisories.some((a) => a.includes("cp git-hooks/"))).toBe(true);
  });
});

describe("assessGitHooksInstallDrift", () => {
  it("returns empty when git-hooks folder absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-drift-"));
    expect(await assessGitHooksInstallDrift(root)).toEqual([]);
  });

  it("advises when installed hook is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-drift-"));
    await mkdir(path.join(root, "git-hooks"), { recursive: true });
    await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
    await writeFile(path.join(root, "git-hooks", "pre-commit"), "#!/bin/sh\n", "utf8");
    const tips = await assessGitHooksInstallDrift(root);
    expect(tips.some((t) => t.includes("pre-commit") && t.includes("missing"))).toBe(true);
  });

  it("advises when contents differ", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-drift-"));
    await mkdir(path.join(root, "git-hooks"), { recursive: true });
    await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
    await writeFile(path.join(root, "git-hooks", "pre-push"), "A\n", "utf8");
    await writeFile(path.join(root, ".git", "hooks", "pre-push"), "B\n", "utf8");
    const tips = await assessGitHooksInstallDrift(root);
    expect(tips.some((t) => t.includes("differs") && t.includes("pre-push"))).toBe(true);
  });

  it("returns empty when installed matches canonical", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-drift-"));
    await mkdir(path.join(root, "git-hooks"), { recursive: true });
    await mkdir(path.join(root, ".git", "hooks"), { recursive: true });
    const body = "#!/bin/sh\nexit 0\n";
    for (const name of ["pre-commit", "pre-push", "prepare-commit-msg"] as const) {
      await writeFile(path.join(root, "git-hooks", name), body, "utf8");
      await writeFile(path.join(root, ".git", "hooks", name), body, "utf8");
    }
    expect(await assessGitHooksInstallDrift(root)).toEqual([]);
  });
});
