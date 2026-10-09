import { describe, expect, it } from "vitest";
import {
  CLAUDE_MIN_VERSION,
  checkClaudeVersion,
  claudeHeadlessArgs,
  cursorAgentHeadlessArgs,
  resetClaudeVersionCache,
} from "./backends.js";
import {
  VENDOR_CLI_PINS,
  compareVendorVersions,
  parseVendorVersion,
  vendorVersionStatus,
} from "./vendor-cli-pins.js";

/**
 * Contract pins for the vendor CLIs the headless runner drives. Changing a
 * pinned value or flag here is a deliberate contract change: re-verify on a
 * host with the binary and update the fixture that emulates it.
 */
describe("vendor CLI pins (contract)", () => {
  it("pins the tested versions recorded on 2026-10-08", () => {
    expect(VENDOR_CLI_PINS.claude).toMatchObject({ min: "2.1.259", tested: "2.1.292" });
    expect(VENDOR_CLI_PINS["cursor-agent"]).toMatchObject({ min: null, tested: "2026.10.01" });
    expect(VENDOR_CLI_PINS.codex).toMatchObject({ min: null, tested: "0.160.1" });
    expect(CLAUDE_MIN_VERSION).toBe(VENDOR_CLI_PINS.claude.min);
  });

  it("parses each vendor's real --version output", () => {
    expect(parseVendorVersion("claude", "2.1.292 (Claude Code)")).toBe("2.1.292");
    expect(parseVendorVersion("cursor-agent", "2026.10.01-e373342")).toBe("2026.10.01");
    expect(parseVendorVersion("codex", "codex-cli 0.160.1")).toBe("0.160.1");
    expect(parseVendorVersion("codex", "")).toBe(null);
  });

  it("orders versions numerically and classifies them against the pin", () => {
    expect(compareVendorVersions("2.1.300", "2.1.292")).toBeGreaterThan(0);
    expect(compareVendorVersions("2026.9.30", "2026.10.01")).toBeLessThan(0);
    expect(vendorVersionStatus("claude", "2.1.100").status).toBe("too-old");
    expect(vendorVersionStatus("claude", "2.1.292 (Claude Code)").status).toBe("supported");
    expect(vendorVersionStatus("cursor-agent", "2026.11.02-abc").status).toBe("newer-than-tested");
    expect(vendorVersionStatus("codex", "codex-cli 0.150.0").status).toBe("supported");
    expect(vendorVersionStatus("codex", null).status).toBe("unknown");
  });

  it("a claude newer than the tested pin runs with a named warning", () => {
    resetClaudeVersionCache();
    const check = checkClaudeVersion("pins-newer", () => "2.2.0 (Claude Code)");
    expect(check.ok).toBe(true);
    expect(check.ok && check.warning).toContain("newer than 2.1.292");
    expect(checkClaudeVersion("pins-tested", () => "2.1.292 (Claude Code)")).toEqual({
      ok: true,
      version: "2.1.292",
    });
  });

  it("pins the headless argv each vendor version was checked with", () => {
    expect(claudeHeadlessArgs().slice(0, 10)).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--permission-prompts",
      "none",
      "--input-format",
      "stream-json",
      "--replay-user-messages",
    ]);
    expect(cursorAgentHeadlessArgs({ workspace: "/w", prompt: "p" })).toEqual([
      "-p",
      "--force",
      "--sandbox",
      "disabled",
      "--output-format",
      "stream-json",
      "--workspace",
      "/w",
      "p",
    ]);
  });
});
