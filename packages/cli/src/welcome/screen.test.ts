import { defineCommand } from "citty";
import { afterEach, describe, expect, it } from "vitest";
import { CLI_HELP_GROUPS, renderGroupedRootHelp } from "./help-groups.js";
import {
  HELMET_ACCENT,
  HELMET_FILL,
  HELMET_OUTLINE,
  hasCliSubcommand,
  renderHelmetAscii,
  renderWelcomeScreen,
  shouldUseWelcomeColor,
} from "./screen.js";

function clearEnv(key: string): void {
  Reflect.deleteProperty(process.env, key);
}

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) clearEnv(key);
  else process.env[key] = value;
}

describe("welcome color gate", () => {
  const prev = {
    NO_COLOR: process.env.NO_COLOR,
    CI: process.env.CI,
    FORCE_COLOR: process.env.FORCE_COLOR,
    NODE_DISABLE_COLORS: process.env.NODE_DISABLE_COLORS,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      setEnv(k, v);
    }
  });

  it("disables color when NO_COLOR is set", () => {
    setEnv("NO_COLOR", "1");
    clearEnv("CI");
    clearEnv("FORCE_COLOR");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: true, color: undefined })).toBe(false);
  });

  it("disables color in CI even on TTY", () => {
    clearEnv("NO_COLOR");
    setEnv("CI", "true");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: true })).toBe(false);
  });

  it("treats any non-empty CI as CI", () => {
    clearEnv("NO_COLOR");
    setEnv("CI", "yes");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: true })).toBe(false);
  });

  it("disables color when stdout is not a TTY", () => {
    clearEnv("NO_COLOR");
    clearEnv("CI");
    clearEnv("FORCE_COLOR");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: false })).toBe(false);
  });

  it("allows color on TTY when env permits", () => {
    clearEnv("NO_COLOR");
    clearEnv("CI");
    clearEnv("FORCE_COLOR");
    clearEnv("NODE_DISABLE_COLORS");
    expect(shouldUseWelcomeColor({ stdoutIsTTY: true })).toBe(true);
  });
});

describe("renderWelcomeScreen", () => {
  it("prints Mission Kit chrome and agent-kit technical ids (plain)", () => {
    const out = renderWelcomeScreen({ version: "9.9.9", color: false });
    expect(out).toContain("Mission Kit");
    expect(out).toContain("agent-kit v9.9.9");
    expect(out).toContain("@dadado/agent-kit-cli");
    expect(out).toContain("agent-kit doctor");
    expect(out).toContain("agent-kit dashboard");
    expect(out).toContain("HITL");
    expect(out.includes("\u001b")).toBe(false);
    expect(out).toMatch(
      /Try agent-kit doctor|HITL gates stay|never promotes|Mission Control is the dashboard|NO_COLOR and CI|groups SETUP/,
    );
  });

  it("includes helmet ASCII frame lines", () => {
    const helmet = renderHelmetAscii(false);
    expect(helmet).toContain(".-'");
    expect(helmet.split("\n").length).toBeGreaterThanOrEqual(8);
  });

  it("exports brand token hex constants", () => {
    expect(HELMET_OUTLINE).toMatch(/^#/);
    expect(HELMET_FILL).toBe("#0C8DEB");
    expect(HELMET_ACCENT).toBe("#00D0E7");
  });

  it("applies HELMET_OUTLINE trueColor to outline lines in colored helmet", () => {
    const [r, g, b] = [
      Number.parseInt(HELMET_OUTLINE.slice(1, 3), 16),
      Number.parseInt(HELMET_OUTLINE.slice(3, 5), 16),
      Number.parseInt(HELMET_OUTLINE.slice(5, 7), 16),
    ];
    const seq = `\u001b[38;2;${r};${g};${b}m`;
    const colored = renderHelmetAscii(true);
    expect(colored).toContain(seq);
    expect(colored.split("\n")[0]).toContain(seq);
  });
});

describe("renderGroupedRootHelp", () => {
  it("groups SETUP / MISSION / DASHBOARD / INTEGRITY", async () => {
    const cmd = defineCommand({
      meta: {
        name: "agent-kit",
        version: "1.2.3",
        description: "test",
      },
      subCommands: {
        init: defineCommand({ meta: { name: "init", description: "Init help" } }),
        handoff: defineCommand({ meta: { name: "handoff", description: "Handoff help" } }),
        dashboard: defineCommand({ meta: { name: "dashboard", description: "Dash help" } }),
        validate: defineCommand({ meta: { name: "validate", description: "Val help" } }),
      },
    });
    const text = await renderGroupedRootHelp(cmd);
    expect(text).toContain("SETUP");
    expect(text).toContain("MISSION");
    expect(text).toContain("DASHBOARD");
    expect(text).toContain("INTEGRITY");
    expect(text).toContain("init");
    expect(text).toContain("Chat-only HITL");
    expect(text).toMatch(
      /Try agent-kit doctor|HITL gates stay|never promotes|Mission Control is the dashboard|NO_COLOR and CI|groups SETUP/,
    );
    for (const g of CLI_HELP_GROUPS) {
      expect(g.commands.length).toBeGreaterThan(0);
    }
  });
});

describe("hasCliSubcommand", () => {
  it("treats bare invoke and flag-only argv as welcome paths", () => {
    expect(hasCliSubcommand([])).toBe(false);
    expect(hasCliSubcommand(["--help"])).toBe(false);
    expect(hasCliSubcommand(["--version"])).toBe(false);
    expect(hasCliSubcommand(["--nope"])).toBe(false);
  });

  it("detects a subcommand token", () => {
    expect(hasCliSubcommand(["status"])).toBe(true);
    expect(hasCliSubcommand(["doctor", "--help"])).toBe(true);
  });
});
