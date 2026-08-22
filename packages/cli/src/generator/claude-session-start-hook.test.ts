import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_SETTINGS_REL,
  SESSION_START_HOOK_MARKER,
  buildSessionStartHookCommand,
  buildSessionStartHookEntry,
  mergeSessionStartHookIntoSettings,
  writeClaudeSessionStartHook,
} from "./claude-session-start-hook.js";

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
    expect(cmd).toContain("&& exec $AGENT_KIT_RESOLVED hook session-start --format claude; printf");
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

  it("degrades to print-instructions on unparseable existing JSON, never guesses/overwrites", () => {
    const result = mergeSessionStartHookIntoSettings("{ not valid json");
    expect(result.status).toBe("unavailable");
    expect(result.content).toBeNull();
    expect(result.instructions).toContain(CLAUDE_SETTINGS_REL);
    expect(result.instructions).toContain(SESSION_START_HOOK_MARKER);
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
    expect(parsed.permissions).toEqual({ allow: ["Bash(git status:*)"] });
    expect(parsed.hooks.SessionStart).toHaveLength(1);
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
