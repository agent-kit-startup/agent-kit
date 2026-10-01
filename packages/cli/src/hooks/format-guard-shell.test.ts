import { describe, expect, it } from "vitest";
import { evaluateShellCommand } from "../invariants/shell-guard.js";
import {
  extractGuardShellInput,
  formatGuardShellOutput,
  resolveGuardShellFormat,
} from "./format-guard-shell.js";

const DENIED = evaluateShellCommand("git reset --hard HEAD");
const ALLOWED = evaluateShellCommand("ls -la");

describe("resolveGuardShellFormat", () => {
  it("resolves 'claude' explicitly", () => {
    expect(resolveGuardShellFormat("claude")).toBe("claude");
  });

  it("defaults to 'cursor' for 'cursor', undefined, unknown strings, and non-strings", () => {
    expect(resolveGuardShellFormat("cursor")).toBe("cursor");
    expect(resolveGuardShellFormat(undefined)).toBe("cursor");
    expect(resolveGuardShellFormat("bogus")).toBe("cursor");
    expect(resolveGuardShellFormat(42)).toBe("cursor");
  });
});

describe("extractGuardShellInput", () => {
  it("claude: extracts a tool_input-only PreToolUse payload", () => {
    const payload = {
      session_id: "s1",
      cwd: "/repo",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git reset --hard HEAD" },
    };
    expect(extractGuardShellInput(payload, "claude")).toEqual({
      command: "git reset --hard HEAD",
      cwd: "/repo",
    });
  });

  it("claude: tool_input.command wins over a top-level command", () => {
    const payload = { command: "ls", tool_input: { command: "git clean -fd" } };
    expect(extractGuardShellInput(payload, "claude").command).toBe("git clean -fd");
  });

  it("claude: never falls back to a top-level command", () => {
    expect(extractGuardShellInput({ command: "git clean -fd" }, "claude").command).toBe("");
    expect(
      extractGuardShellInput({ command: "git clean -fd", tool_input: { command: 1 } }, "claude")
        .command,
    ).toBe("");
  });

  it("cursor: reads top-level command and cwd (contract unchanged)", () => {
    expect(extractGuardShellInput({ command: "ls", cwd: "/r" }, "cursor")).toEqual({
      command: "ls",
      cwd: "/r",
    });
  });

  it("tolerates non-object payloads", () => {
    expect(extractGuardShellInput(null, "claude")).toEqual({ command: "", cwd: undefined });
    expect(extractGuardShellInput("x", "cursor")).toEqual({ command: "", cwd: undefined });
  });
});

describe("formatGuardShellOutput", () => {
  it("cursor: byte-identical to JSON.stringify(result) for deny and allow", () => {
    expect(formatGuardShellOutput(DENIED, "cursor")).toBe(JSON.stringify(DENIED));
    expect(formatGuardShellOutput(ALLOWED, "cursor")).toBe(JSON.stringify(ALLOWED));
    expect(formatGuardShellOutput(ALLOWED, "cursor")).toMatchInlineSnapshot(
      `"{"permission":"allow"}"`,
    );
  });

  it("claude deny: exactly hookSpecificOutput with 3 keys", () => {
    expect(DENIED.permission).toBe("deny");
    const out = JSON.parse(formatGuardShellOutput(DENIED, "claude"));
    expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
    expect(Object.keys(out.hookSpecificOutput).sort()).toEqual([
      "hookEventName",
      "permissionDecision",
      "permissionDecisionReason",
    ]);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe(DENIED.agent_message);
  });

  it("claude allow: empty string, never 'allow'", () => {
    const out = formatGuardShellOutput(ALLOWED, "claude");
    expect(out).toBe("");
    expect(out).not.toContain("allow");
  });
});
