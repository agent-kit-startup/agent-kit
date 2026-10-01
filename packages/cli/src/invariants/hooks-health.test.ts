import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assessClaudeGuardProbe,
  assessGitHooksInstallDrift,
  assessHooksHealth,
  assessSignatureGateHook,
} from "./hooks-health.js";

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

describe("assessClaudeGuardProbe", () => {
  const DENY = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "blocked",
    },
  });

  beforeEach(() => {
    vi.stubEnv("AGENT_KIT_HOOK_BIN", "");
    vi.stubEnv("PATH", "/usr/bin:/bin");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function setup(settings: unknown | null, cliStdout?: string) {
    const root = await mkdtemp(path.join(tmpdir(), "ak-guard-probe-"));
    if (settings !== null) {
      await mkdir(path.join(root, ".claude"), { recursive: true });
      await writeFile(
        path.join(root, ".claude", "settings.json"),
        JSON.stringify(settings),
        "utf8",
      );
    }
    if (cliStdout !== undefined) {
      const bin = path.join(root, "node_modules", ".bin");
      await mkdir(bin, { recursive: true });
      const script = path.join(bin, "agent-kit");
      await writeFile(script, `#!/bin/sh\nprintf '%s' '${cliStdout}'\n`, "utf8");
      await chmod(script, 0o755);
    }
    return root;
  }

  const withGuard = {
    hooks: {
      SessionStart: [{ hooks: [{ command: "x hook session-start --format claude" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ command: "x guard shell --format claude" }] }],
    },
  };

  it("is silent without .claude/settings.json", async () => {
    expect(await assessClaudeGuardProbe(await setup(null))).toEqual([]);
  });

  it("is silent when the guard hook is active and the CLI denies", async () => {
    expect(await assessClaudeGuardProbe(await setup(withGuard, DENY))).toEqual([]);
  });

  it("advises when the resolved CLI answers in the Cursor format (old CLI)", async () => {
    const root = await setup(withGuard, '{"permission":"deny","user_message":"blocked"}');
    const tips = await assessClaudeGuardProbe(root);
    expect(tips).toHaveLength(1);
    expect(tips[0]).toContain("too old or stale dist");
  });

  it("advises when the resolved CLI prints nothing", async () => {
    const tips = await assessClaudeGuardProbe(await setup(withGuard, ""));
    expect(tips[0]).toContain("too old or stale dist");
  });

  it("advises when the CLI cannot be resolved", async () => {
    const tips = await assessClaudeGuardProbe(await setup(withGuard));
    expect(tips[0]).toContain("too old or stale dist");
  });

  it("advises to run install --claude when only the SessionStart marker is present", async () => {
    const root = await setup({ hooks: { SessionStart: withGuard.hooks.SessionStart } });
    const tips = await assessClaudeGuardProbe(root);
    expect(tips).toHaveLength(1);
    expect(tips[0]).toContain("agent-kit install --claude");
  });

  it("is silent when settings carry no kit marker", async () => {
    expect(await assessClaudeGuardProbe(await setup({ permissions: {} }))).toEqual([]);
  });

  it("surfaces through assessHooksHealth advisories", async () => {
    const root = await setup(withGuard, '{"permission":"deny"}');
    const report = await assessHooksHealth(root);
    expect(report.advisories.some((a) => a.includes("too old or stale dist"))).toBe(true);
  });
});

describe("assessSignatureGateHook", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "sig-gate-"));
  });

  async function kitMarker() {
    await mkdir(path.join(root, "autogit"), { recursive: true });
    await writeFile(path.join(root, "autogit", "gitupdate.md"), "# gitupdate\n", "utf8");
  }

  it("is silent without the kit marker", async () => {
    expect(await assessSignatureGateHook(root)).toEqual([]);
  });

  it("flags a missing hook file with the update remedy when git-hooks/ is absent", async () => {
    await kitMarker();
    const tips = await assessSignatureGateHook(root);
    expect(tips).toHaveLength(1);
    expect(tips[0]).toContain("git-hooks/prepare-commit-msg");
    expect(tips[0]).toContain("agent-kit update");
  });

  it("flags a missing hook file when git-hooks/ exists without it", async () => {
    await kitMarker();
    await mkdir(path.join(root, "git-hooks"), { recursive: true });
    await writeFile(path.join(root, "git-hooks", "pre-commit"), "#!/bin/sh\n", "utf8");
    expect(await assessSignatureGateHook(root)).toHaveLength(1);
  });

  it("is silent when the hook file is present", async () => {
    await kitMarker();
    await mkdir(path.join(root, "git-hooks"), { recursive: true });
    await writeFile(path.join(root, "git-hooks", "prepare-commit-msg"), "#!/bin/sh\n", "utf8");
    expect(await assessSignatureGateHook(root)).toEqual([]);
  });

  it("surfaces through assessHooksHealth advisories even with no hooks.json", async () => {
    await kitMarker();
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("missing");
    expect(report.advisories.some((a) => a.includes("prepare-commit-msg"))).toBe(true);
  });
});
