import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HEADLESS_ONLY_DENY_RULES, INTERACTIVE_DENY_RULES } from "./claude-permissions.js";
import {
  CLAUDE_SETTINGS_REL,
  GUARD_SHELL_HOOK_MARKER,
  SESSION_START_DEGRADED_TEXT,
  SESSION_START_HOOK_MARKER,
  buildGuardShellHookCommand,
  buildGuardShellHookEntry,
  buildSessionStartHookCommand,
  buildSessionStartHookEntry,
  mergeSessionStartHookIntoSettings,
  upsertMarkedGroup,
  writeClaudeSessionStartHook,
} from "./claude-session-start-hook.js";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("buildSessionStartHookCommand", () => {
  it("carries the marker, uses ${CLAUDE_PROJECT_DIR} (not a monorepo-relative path), and has no node -e unwrapper", () => {
    const cmd = buildSessionStartHookCommand();
    expect(cmd).toContain(SESSION_START_HOOK_MARKER);
    expect(cmd).toContain('"${CLAUDE_PROJECT_DIR}/.cursor/hooks/agent/resolve-agent-kit.sh"');
    expect(cmd).not.toContain("node -e");
    expect(cmd).not.toContain("packages/cli/dist");
  });

  it("is fail-open: exec on success replaces the process, printf degraded text runs otherwise, exit is always 0", () => {
    const cmd = buildSessionStartHookCommand();
    expect(cmd.startsWith('_AGENT_KIT_HOOK_ROOT="${CLAUDE_PROJECT_DIR}"; ')).toBe(true);
    expect(cmd).toContain(
      "then run_agent_kit hook session-start --format claude; else exec $AGENT_KIT_RESOLVED hook session-start --format claude; fi; }; printf",
    );
  });

  it("prints the degraded text and exits 0 when node is absent for a dist-only project", async () => {
    const resolver = await readFile(
      path.join(repoRoot, ".cursor/hooks/agent/resolve-agent-kit.sh"),
      "utf8",
    );
    const project = await mkdtemp(path.join(tmpdir(), "ak-claude-hook-nonode-"));
    await mkdir(path.join(project, ".cursor/hooks/agent"), { recursive: true });
    await writeFile(path.join(project, ".cursor/hooks/agent/resolve-agent-kit.sh"), resolver);
    await mkdir(path.join(project, "packages/cli/dist"), { recursive: true });
    await writeFile(
      path.join(project, "packages/cli/dist/index.js"),
      'process.stdout.write("ran");\n',
    );

    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      HOME: project,
      CLAUDE_PROJECT_DIR: project,
    };
    const probe = spawnSync("sh", ["-c", "command -v node || command -v agent-kit"], {
      env,
      encoding: "utf8",
    });
    expect(probe.status).not.toBe(0); // precondition: neither node nor a global CLI on PATH

    const result = spawnSync("sh", ["-c", buildSessionStartHookCommand()], {
      cwd: project,
      env,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(SESSION_START_DEGRADED_TEXT);
  });

  it("runs the resolved CLI with quoted args, and still runs with an older resolver", async () => {
    const newResolver = await readFile(
      path.join(repoRoot, ".cursor/hooks/agent/resolve-agent-kit.sh"),
      "utf8",
    );
    // An older resolver (no run_agent_kit) that a consumer kept customized.
    const oldResolver = newResolver.replace(/\n# Exec the resolved CLI[\s\S]*$/, "\n");
    expect(oldResolver).not.toContain("run_agent_kit()");

    const setup = async (resolver: string) => {
      const project = path.join(await mkdtemp(path.join(tmpdir(), "ak-claude-hook-")), "my repo");
      await mkdir(path.join(project, ".cursor/hooks/agent"), { recursive: true });
      await writeFile(path.join(project, ".cursor/hooks/agent/resolve-agent-kit.sh"), resolver);
      const bin = path.join(project, "tools bin");
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(bin, "agent-kit"), '#!/bin/sh\nprintf "ran:%s" "$*"\n');
      await chmod(path.join(bin, "agent-kit"), 0o755);
      return { project, bin };
    };
    const run = (env: NodeJS.ProcessEnv, cwd: string) =>
      spawnSync("sh", ["-c", buildSessionStartHookCommand()], { cwd, env, encoding: "utf8" });

    // New resolver: AGENT_KIT_HOOK_BIN under a path with spaces runs via run_agent_kit.
    const a = await setup(newResolver);
    const viaBin = run(
      {
        PATH: "/usr/bin:/bin",
        HOME: a.project,
        CLAUDE_PROJECT_DIR: a.project,
        AGENT_KIT_HOOK_BIN: path.join(a.bin, "agent-kit"),
      },
      a.project,
    );
    expect(viaBin.status).toBe(0);
    expect(viaBin.stdout).toBe("ran:hook session-start --format claude");

    // Older resolver without run_agent_kit: falls back to exec $AGENT_KIT_RESOLVED.
    const b = await setup(oldResolver);
    const viaPath = run(
      { PATH: `${b.bin}:/usr/bin:/bin`, HOME: b.project, CLAUDE_PROJECT_DIR: b.project },
      b.project,
    );
    expect(viaPath.status).toBe(0);
    expect(viaPath.stdout).toBe("ran:hook session-start --format claude");
  });

  it("finds <project>/node_modules/.bin/agent-kit under sh -c, where $0 is the shell", async () => {
    const resolver = await readFile(
      path.join(repoRoot, ".cursor/hooks/agent/resolve-agent-kit.sh"),
      "utf8",
    );
    const project = await mkdtemp(path.join(tmpdir(), "ak-claude-hook-root-"));
    await mkdir(path.join(project, ".cursor/hooks/agent"), { recursive: true });
    await writeFile(path.join(project, ".cursor/hooks/agent/resolve-agent-kit.sh"), resolver);
    const bin = path.join(project, "node_modules/.bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "agent-kit"), '#!/bin/sh\nprintf "local:%s" "$*"\n');
    await chmod(path.join(bin, "agent-kit"), 0o755);

    // PATH has no agent-kit; only the project-local stub can satisfy the resolve.
    const result = spawnSync("sh", ["-c", buildSessionStartHookCommand()], {
      cwd: project,
      env: { PATH: "/usr/bin:/bin", HOME: project, CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("local:hook session-start --format claude");
  });
});

describe("mergeSessionStartHookIntoSettings", () => {
  it("creates hooks.SessionStart from scratch when the file does not exist", () => {
    const result = mergeSessionStartHookIntoSettings(null);
    expect(result.status).toBe("applied");
    const parsed = JSON.parse(result.content ?? "{}");
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toContain(SESSION_START_HOOK_MARKER);
  });

  it("preserves unrelated top-level keys and other hook types", () => {
    const existing = JSON.stringify({
      env: { FOO: "bar" },
      hooks: { PreCompact: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
    });
    const result = mergeSessionStartHookIntoSettings(existing);
    const parsed = JSON.parse(result.content ?? "{}");
    expect(parsed.env).toEqual({ FOO: "bar" });
    expect(parsed.hooks.PreCompact).toEqual([{ hooks: [{ type: "command", command: "echo hi" }] }]);
    expect(parsed.hooks.SessionStart).toHaveLength(1);
  });

  it("preserves a user's own pre-existing SessionStart hook alongside the kit one (hooks merge, not shadow)", () => {
    const existing = JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo user-hook" }] }] },
    });
    const result = mergeSessionStartHookIntoSettings(existing);
    const parsed = JSON.parse(result.content ?? "{}");
    expect(parsed.hooks.SessionStart).toHaveLength(2);
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo user-hook");
    expect(parsed.hooks.SessionStart[1].hooks[0].command).toContain(SESSION_START_HOOK_MARKER);
  });

  it("is idempotent: re-merging an already-kit-owned entry reports unchanged and does not duplicate", () => {
    const first = mergeSessionStartHookIntoSettings(null);
    const second = mergeSessionStartHookIntoSettings(first.content);
    expect(second.status).toBe("unchanged");
    const parsed = JSON.parse(second.content ?? "{}");
    expect(parsed.hooks.SessionStart).toHaveLength(1);
  });

  it("refreshes (in place, no duplicate) when the kit entry's own content has drifted from current", () => {
    const stale = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `old command with a stale flavor of ${SESSION_START_HOOK_MARKER}`,
                timeout: 5,
              },
            ],
          },
        ],
      },
    });
    const result = mergeSessionStartHookIntoSettings(stale);
    expect(result.status).toBe("refreshed");
    const parsed = JSON.parse(result.content ?? "{}");
    expect(parsed.hooks.SessionStart).toEqual([{ hooks: [buildSessionStartHookEntry()] }]);
  });

  it("unions the interactive deny rules: user entries kept, kit rules once, headless-only rows absent, idempotent", () => {
    const existing = JSON.stringify({
      permissions: {
        allow: ["Bash(git push origin *)"],
        deny: ["Bash(rm -rf *)", "Bash(git push * main)"],
      },
    });
    const first = mergeSessionStartHookIntoSettings(existing);
    expect(first.status).toBe("applied");
    const deny: string[] = JSON.parse(first.content ?? "{}").permissions.deny;
    expect(deny.slice(0, 2)).toEqual(["Bash(rm -rf *)", "Bash(git push * main)"]);
    for (const rule of INTERACTIVE_DENY_RULES) {
      expect(
        deny.filter((r) => r === rule),
        rule,
      ).toHaveLength(1);
    }
    for (const rule of HEADLESS_ONLY_DENY_RULES) {
      expect(deny, rule).not.toContain(rule);
    }
    expect(JSON.parse(first.content ?? "{}").permissions.allow).toEqual([
      "Bash(git push origin *)",
    ]);

    const second = mergeSessionStartHookIntoSettings(first.content);
    expect(second.status).toBe("unchanged");
    expect(second.content).toBe(first.content);
  });

  it("leaves a non-array permissions.deny untouched", () => {
    const existing = JSON.stringify({ permissions: { deny: "Bash(rm *)" } });
    const parsed = JSON.parse(mergeSessionStartHookIntoSettings(existing).content ?? "{}");
    expect(parsed.permissions).toEqual({ deny: "Bash(rm *)" });
  });

  it("degrades to print-instructions on unparseable existing JSON, never guesses/overwrites", () => {
    const result = mergeSessionStartHookIntoSettings("{ not valid json");
    expect(result.status).toBe("unavailable");
    expect(result.content).toBeNull();
    expect(result.instructions).toContain(CLAUDE_SETTINGS_REL);
    expect(result.instructions).toContain(SESSION_START_HOOK_MARKER);
    expect(result.instructions).toContain(GUARD_SHELL_HOOK_MARKER);
    expect(result.instructions).toContain("hooks.PreToolUse");
  });
});

describe("buildGuardShellHookCommand", () => {
  it("carries the marker and CLAUDE_PROJECT_DIR, timeout 10, and no printf/degraded output", () => {
    const cmd = buildGuardShellHookCommand();
    expect(cmd).toContain(GUARD_SHELL_HOOK_MARKER);
    expect(cmd).toContain("${CLAUDE_PROJECT_DIR}");
    expect(cmd).not.toContain("printf");
    expect(cmd.endsWith("fi; }; :")).toBe(true); // trailing `:` forces exit 0 on fail-open
    expect(buildGuardShellHookEntry()).toEqual({ type: "command", command: cmd, timeout: 10 });
  });
});

describe("mergeSessionStartHookIntoSettings PreToolUse", () => {
  const guardGroup = () => ({ matcher: "Bash", hooks: [buildGuardShellHookEntry()] });

  it("adds the Bash guard group and keeps a user's PreToolUse group first", () => {
    const user = { matcher: "Write", hooks: [{ type: "command", command: "echo user" }] };
    const result = mergeSessionStartHookIntoSettings(
      JSON.stringify({ hooks: { PreToolUse: [user] } }),
    );
    expect(result.status).toBe("applied");
    expect(JSON.parse(result.content ?? "{}").hooks.PreToolUse).toEqual([user, guardGroup()]);
  });

  it("is idempotent and never duplicates the kit group", () => {
    const first = mergeSessionStartHookIntoSettings(null);
    const second = mergeSessionStartHookIntoSettings(first.content);
    expect(second.status).toBe("unchanged");
    expect(JSON.parse(second.content ?? "{}").hooks.PreToolUse).toHaveLength(1);
  });

  it("refreshes a drifted guard group in place while SessionStart stays unchanged", () => {
    const base = JSON.parse(mergeSessionStartHookIntoSettings(null).content ?? "{}");
    base.hooks.PreToolUse = [
      { matcher: "Bash", hooks: [{ type: "command", command: `old ${GUARD_SHELL_HOOK_MARKER}` }] },
    ];
    const result = mergeSessionStartHookIntoSettings(JSON.stringify(base));
    expect(result.status).toBe("refreshed");
    expect(JSON.parse(result.content ?? "{}").hooks.PreToolUse).toEqual([guardGroup()]);
  });

  it("reports refreshed when only the guard group is new (older SessionStart-only install)", () => {
    const base = JSON.parse(mergeSessionStartHookIntoSettings(null).content ?? "{}");
    base.hooks.PreToolUse = undefined;
    const result = mergeSessionStartHookIntoSettings(JSON.stringify(base));
    expect(result.status).toBe("refreshed");
  });
});

describe("upsertMarkedGroup", () => {
  const marker = "some marker";
  const group = { matcher: "Bash", hooks: [{ type: "command", command: `run ${marker}` }] };

  it("appends when no group carries the marker (applied), keeping other groups", () => {
    const other = { hooks: [{ type: "command", command: "user hook" }] };
    const arr: unknown[] = [other];
    expect(upsertMarkedGroup(arr, group, marker)).toBe("applied");
    expect(arr).toEqual([other, group]);
  });

  it("leaves an identical marked group alone (unchanged)", () => {
    const arr: unknown[] = [{ ...group }];
    expect(upsertMarkedGroup(arr, group, marker)).toBe("unchanged");
    expect(arr).toHaveLength(1);
  });

  it("replaces a drifted marked group in place (refreshed), no duplicate", () => {
    const drifted = { hooks: [{ type: "command", command: `old ${marker}`, timeout: 1 }] };
    const arr: unknown[] = [drifted];
    expect(upsertMarkedGroup(arr, group, marker)).toBe("refreshed");
    expect(arr).toEqual([group]);
  });
});

describe("writeClaudeSessionStartHook", () => {
  it("writes .claude/settings.json when absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-"));
    const result = await writeClaudeSessionStartHook(root);
    expect(result.status).toBe("applied");
    const body = await readFile(path.join(root, CLAUDE_SETTINGS_REL), "utf8");
    expect(body).toContain(SESSION_START_HOOK_MARKER);
  });

  it("is idempotent across two full install-style runs (fresh install / re-run)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-idempotent-"));
    const first = await writeClaudeSessionStartHook(root);
    const second = await writeClaudeSessionStartHook(root);
    expect(first.status).toBe("applied");
    expect(second.status).toBe("unchanged");
    const parsed = JSON.parse(await readFile(path.join(root, CLAUDE_SETTINGS_REL), "utf8"));
    expect(parsed.hooks.SessionStart).toHaveLength(1);
  });

  it("preserves an existing settings.json's unrelated content (existing settings scenario)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-existing-"));
    const dir = path.join(root, ".claude");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(git status:*)"] } }),
      "utf8",
    );
    const result = await writeClaudeSessionStartHook(root);
    expect(result.status).toBe("applied");
    const parsed = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
    expect(parsed.permissions).toEqual({
      allow: ["Bash(git status:*)"],
      deny: [...INTERACTIVE_DENY_RULES],
    });
    expect(parsed.hooks.SessionStart).toHaveLength(1);
  });

  it("adds the kit deny rules to an existing hook-only settings.json and then stays unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-deny-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const settingsPath = path.join(root, CLAUDE_SETTINGS_REL);
    await writeFile(
      settingsPath,
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [buildSessionStartHookEntry()] }] } }),
      "utf8",
    );
    expect((await writeClaudeSessionStartHook(root)).status).toBe("refreshed");
    const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(parsed.permissions.deny).toEqual([...INTERACTIVE_DENY_RULES]);
    expect((await writeClaudeSessionStartHook(root)).status).toBe("unchanged");
  });

  it("never writes and surfaces instructions when existing settings.json is unparseable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-broken-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    const settingsPath = path.join(root, CLAUDE_SETTINGS_REL);
    await writeFile(settingsPath, "{ not valid json at all", "utf8");

    const result = await writeClaudeSessionStartHook(root);
    expect(result.status).toBe("unavailable");
    expect(result.instructions).toBeTruthy();
    expect(await readFile(settingsPath, "utf8")).toBe("{ not valid json at all");
  });
});

describe("buildGuardShellHookCommand end-to-end (sh -c, PreToolUse stdin)", () => {
  const denyJson =
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"stub deny"}}';
  const stdin = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git push origin main" },
  });

  const readResolver = () =>
    readFile(path.join(repoRoot, ".cursor/hooks/agent/resolve-agent-kit.sh"), "utf8");

  // Fake CLI: emits the deny only for the exact guard args and a non-empty stdin.
  const fakeCli = `#!/bin/sh\nbody=$(cat)\n[ "$*" = "${GUARD_SHELL_HOOK_MARKER}" ] && [ -n "$body" ] && printf '%s' '${denyJson}'\n`;

  // The older resolver's fallback `exec $AGENT_KIT_RESOLVED` is unquoted, so it needs a space-free path.
  const setup = async (resolver: string, dirName = "my repo") => {
    const project = path.join(await mkdtemp(path.join(tmpdir(), "ak-claude-guard-")), dirName);
    await mkdir(path.join(project, ".cursor/hooks/agent"), { recursive: true });
    await writeFile(path.join(project, ".cursor/hooks/agent/resolve-agent-kit.sh"), resolver);
    const bin = path.join(project, "node_modules/.bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "agent-kit"), fakeCli);
    await chmod(path.join(bin, "agent-kit"), 0o755);
    return project;
  };
  const run = (project: string, env: NodeJS.ProcessEnv = {}) =>
    spawnSync("sh", ["-c", buildGuardShellHookCommand()], {
      cwd: project,
      env: { PATH: "/usr/bin:/bin", HOME: project, CLAUDE_PROJECT_DIR: project, ...env },
      input: stdin,
      encoding: "utf8",
    });
  const expectSingleDeny = (result: { status: number | null; stdout: string }) => {
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout); // throws unless stdout is exactly one JSON value
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.stdout).toBe(denyJson);
  };

  it("current resolver + fake CLI: stdout is exactly one deny JSON object", async () => {
    expectSingleDeny(run(await setup(await readResolver())));
  });

  it("older resolver without run_agent_kit: same single deny JSON object", async () => {
    const oldResolver = (await readResolver()).replace(/\n# Exec the resolved CLI[\s\S]*$/, "\n");
    expect(oldResolver).not.toContain("run_agent_kit()");
    expectSingleDeny(run(await setup(oldResolver, "repo")));
  });

  it("CLI unresolved: exit 0 and empty stdout (no degraded text)", async () => {
    const project = await setup(await readResolver());
    await rm(path.join(project, "node_modules"), { recursive: true });
    const env = { PATH: "/usr/bin:/bin" };
    expect(
      spawnSync("sh", ["-c", "command -v agent-kit"], { env, encoding: "utf8" }).status,
    ).not.toBe(0); // precondition
    const result = run(project);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("node missing for a dist-only CLI: exit 0 and empty stdout", async () => {
    const project = await setup(await readResolver());
    await rm(path.join(project, "node_modules"), { recursive: true });
    await mkdir(path.join(project, "packages/cli/dist"), { recursive: true });
    await writeFile(
      path.join(project, "packages/cli/dist/index.js"),
      'process.stdout.write("x");\n',
    );
    expect(
      spawnSync("sh", ["-c", "command -v node"], {
        env: { PATH: "/usr/bin:/bin" },
        encoding: "utf8",
      }).status,
    ).not.toBe(0); // precondition
    const result = run(project);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("writeClaudeSessionStartHook symlink containment", () => {
  it("refuses a settings.json symlink pointing outside the project and leaves the target unchanged", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-link-"));
    const outside = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-outside-"));
    const target = path.join(outside, "settings.json");
    await writeFile(target, '{"keep":true}\n', "utf8");
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await symlink(target, path.join(root, CLAUDE_SETTINGS_REL));

    const result = await writeClaudeSessionStartHook(root);
    expect(result).toEqual({ relativePath: CLAUDE_SETTINGS_REL, status: "skipped-symlink" });
    expect(await readFile(target, "utf8")).toBe('{"keep":true}\n');
  });

  it("refuses a dangling settings.json symlink without creating the target", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-dangling-"));
    const outside = await mkdtemp(path.join(tmpdir(), "ak-claude-settings-outside-"));
    const target = path.join(outside, "missing.json");
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await symlink(target, path.join(root, CLAUDE_SETTINGS_REL));

    expect((await writeClaudeSessionStartHook(root)).status).toBe("skipped-symlink");
    await expect(readFile(target, "utf8")).rejects.toThrow();
  });

  it("refuses when .claude/ itself is a symlink to a directory outside the project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-claude-dir-link-"));
    const outside = await mkdtemp(path.join(tmpdir(), "ak-claude-dir-outside-"));
    await symlink(outside, path.join(root, ".claude"));

    expect((await writeClaudeSessionStartHook(root)).status).toBe("skipped-symlink");
    await expect(readFile(path.join(outside, "settings.json"), "utf8")).rejects.toThrow();
  });
});

describe("ledger-aware settings merge", () => {
  const ledgerRel = ".cursor/agent-kit.claude-settings.json";
  const readJson = async (root: string, rel: string) =>
    JSON.parse(await readFile(path.join(root, rel), "utf8"));
  const tmp = () => mkdtemp(path.join(tmpdir(), "ak-claude-ledger-"));

  it("fresh install writes everything and saves the ledger; second install is unchanged", async () => {
    const root = await tmp();
    const first = await writeClaudeSessionStartHook(root);
    expect(first.status).toBe("applied");
    expect(first.ledgerPath).toBe(ledgerRel);
    const ledger = await readJson(root, ledgerRel);
    expect(ledger.denyRowsWritten).toEqual([...INTERACTIVE_DENY_RULES].sort());
    expect(ledger.hookEntriesWritten.map((h: { event: string }) => h.event)).toEqual([
      "PreToolUse",
      "SessionStart",
    ]);
    const second = await writeClaudeSessionStartHook(root);
    expect(second.status).toBe("unchanged");
    expect(second.ledgerPath).toBeUndefined();
  });

  it("an operator-deleted deny row in the ledger stays deleted after 2 installs", async () => {
    const root = await tmp();
    await writeClaudeSessionStartHook(root);
    const settings = await readJson(root, CLAUDE_SETTINGS_REL);
    const dropped = INTERACTIVE_DENY_RULES[0];
    settings.permissions.deny = settings.permissions.deny.filter((r: string) => r !== dropped);
    await writeFile(path.join(root, CLAUDE_SETTINGS_REL), JSON.stringify(settings), "utf8");
    for (let i = 0; i < 2; i++) {
      const r = await writeClaudeSessionStartHook(root);
      expect(r.status).toBe("unchanged");
    }
    const after = await readJson(root, CLAUDE_SETTINGS_REL);
    expect(after.permissions.deny).not.toContain(dropped);
  });

  it("deleted SessionStart/PreToolUse entries recorded in the ledger are not re-added", async () => {
    const root = await tmp();
    await writeClaudeSessionStartHook(root);
    const settings = await readJson(root, CLAUDE_SETTINGS_REL);
    settings.hooks = {};
    await writeFile(path.join(root, CLAUDE_SETTINGS_REL), JSON.stringify(settings), "utf8");
    const r = await writeClaudeSessionStartHook(root);
    expect(r.status).toBe("unchanged");
    const after = await readJson(root, CLAUDE_SETTINGS_REL);
    expect(after.hooks.SessionStart ?? []).toHaveLength(0);
    expect(after.hooks.PreToolUse ?? []).toHaveLength(0);
  });

  it("a new kit row (absent from present and ledger) is added once, idempotently", () => {
    const rows = INTERACTIVE_DENY_RULES.slice(1);
    const ledger = {
      schemaVersion: 1 as const,
      denyRowsWritten: [...rows],
      hookEntriesWritten: [
        { event: "SessionStart", marker: SESSION_START_HOOK_MARKER },
        { event: "PreToolUse", marker: GUARD_SHELL_HOOK_MARKER },
      ],
    };
    const raw = JSON.stringify({ permissions: { deny: ["Bash(mine)", ...rows] } });
    const first = mergeSessionStartHookIntoSettings(raw, { ledger, authorized: false });
    const deny = JSON.parse(first.content ?? "").permissions.deny;
    expect(deny.filter((r: string) => r === INTERACTIVE_DENY_RULES[0])).toHaveLength(1);
    expect(deny[0]).toBe("Bash(mine)");
    const again = mergeSessionStartHookIntoSettings(first.content, { ledger, authorized: false });
    expect(JSON.parse(again.content ?? "").permissions.deny).toEqual(deny);
  });

  it("no ledger: missing rows/entries are pending when unauthorized, added when authorized", () => {
    const raw = JSON.stringify({ permissions: { deny: ["Bash(mine)"] } });
    const dry = mergeSessionStartHookIntoSettings(raw, { authorized: false });
    const dryRoot = JSON.parse(dry.content ?? "");
    expect(dryRoot.permissions.deny).toEqual(["Bash(mine)"]);
    expect(dry.pending?.denyRows).toEqual([...INTERACTIVE_DENY_RULES]);
    expect(dry.pending?.hookEntries).toHaveLength(2);
    const wet = mergeSessionStartHookIntoSettings(raw, { authorized: true });
    expect(JSON.parse(wet.content ?? "").permissions.deny).toEqual([
      "Bash(mine)",
      ...INTERACTIVE_DENY_RULES,
    ]);
    expect(wet.pending?.denyRows).toEqual([]);
  });

  it("no ledger, unauthorized: present kit rows are seeded, never removed or reordered", () => {
    const raw = JSON.stringify({
      permissions: { deny: [INTERACTIVE_DENY_RULES[2], "Bash(mine)"] },
    });
    const r = mergeSessionStartHookIntoSettings(raw, { authorized: false });
    expect(r.ledgerAdditions?.denyRowsWritten).toEqual([INTERACTIVE_DENY_RULES[2]]);
    expect(JSON.parse(r.content ?? "").permissions.deny).toEqual([
      INTERACTIVE_DENY_RULES[2],
      "Bash(mine)",
    ]);
  });

  it("headless-only rows never enter settings or the ledger", async () => {
    const root = await tmp();
    await writeClaudeSessionStartHook(root);
    const body = JSON.stringify([
      await readJson(root, CLAUDE_SETTINGS_REL),
      await readJson(root, ledgerRel),
    ]);
    for (const row of HEADLESS_ONLY_DENY_RULES) expect(body).not.toContain(row);
  });

  it("unauthorized write never creates or grows the ledger", async () => {
    const root = await tmp();
    const r = await writeClaudeSessionStartHook(root, { authorized: false });
    expect(r.pending?.denyRows.length).toBeGreaterThan(0);
    await expect(readFile(path.join(root, ledgerRel), "utf8")).rejects.toThrow();
  });

  it("unparseable settings.json stays unavailable and writes no ledger", async () => {
    const root = await tmp();
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(path.join(root, CLAUDE_SETTINGS_REL), "{nope", "utf8");
    const r = await writeClaudeSessionStartHook(root);
    expect(r.status).toBe("unavailable");
    await expect(readFile(path.join(root, ledgerRel), "utf8")).rejects.toThrow();
  });

  it("a symlinked ledger is refused with nothing written", async () => {
    const root = await tmp();
    const outside = await tmp();
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await symlink(path.join(outside, "l.json"), path.join(root, ledgerRel));
    const r = await writeClaudeSessionStartHook(root);
    expect(r.status).toBe("skipped-symlink");
    await expect(readFile(path.join(root, CLAUDE_SETTINGS_REL), "utf8")).rejects.toThrow();
  });
});
