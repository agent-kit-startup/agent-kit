import { describe, expect, it } from "vitest";
import { DETECT_ORDER, INSTALL_HINTS, detectAgentBackend, listDetectBackendIds } from "./detect.js";

describe("detectAgentBackend", () => {
  it("auto picks the first available binary in DETECT_ORDER", async () => {
    const seen: string[] = [];
    const result = await detectAgentBackend("auto", async (bin) => {
      seen.push(bin);
      if (bin === "claude") return "/usr/bin/claude";
      return null;
    });
    expect(DETECT_ORDER[0]).toBe("cursor-agent");
    expect(seen).toEqual(["cursor-agent", "claude"]);
    expect(result).toEqual({ ok: true, id: "claude", bin: "/usr/bin/claude" });
  });

  it("auto prefers cursor-agent when both exist", async () => {
    const result = await detectAgentBackend("auto", async (bin) =>
      bin === "cursor-agent" ? "/opt/cursor-agent" : "/usr/bin/claude",
    );
    expect(result).toEqual({ ok: true, id: "cursor-agent", bin: "/opt/cursor-agent" });
  });

  it("fails clearly when auto finds none", async () => {
    const result = await detectAgentBackend("auto", async () => null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("No agent CLI found on PATH");
    expect(result.message).toContain(INSTALL_HINTS["cursor-agent"]);
    expect(result.message).toContain(INSTALL_HINTS.claude);
  });

  it("fails a pinned missing binary with an install hint", async () => {
    const result = await detectAgentBackend("cursor-agent", async () => null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("cursor-agent not found on PATH");
    expect(result.message).toContain("cursor.com/docs/cli");
  });

  it("rejects unknown ids and GLM stubs", async () => {
    const unknown = await detectAgentBackend("ultracode", async () => "/fake");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.message).toContain("Unknown backend 'ultracode'");
      expect(unknown.message).toContain("auto, cursor-agent, claude");
    }

    const glm = await detectAgentBackend("glm", async () => "/opt/glm");
    expect(glm.ok).toBe(false);
    if (!glm.ok) {
      expect(glm.message).toContain("No documented GLM CLI binary");
      expect(glm.message).not.toContain("/opt/glm");
    }
  });

  it("lists auto plus concrete backends", () => {
    expect(listDetectBackendIds()).toEqual(["auto", "cursor-agent", "claude"]);
  });
});
