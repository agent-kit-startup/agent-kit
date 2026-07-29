import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assessHooksHealth } from "./hooks-health.js";

describe("assessHooksHealth", () => {
  it("reports missing when hooks.json absent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ak-hooks-"));
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("missing");
  });

  it("reports active for full Node adapter wiring", async () => {
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
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("active");
    expect(report.reasons).toEqual([]);
  });

  it("degrades when stop is present", async () => {
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
          stop: [{ command: "echo no" }],
        },
      }),
      "utf8",
    );
    await writeFile(path.join(agent, "resolve-agent-kit.sh"), "#!/bin/sh\n", "utf8");
    const report = await assessHooksHealth(root);
    expect(report.status).toBe("degraded");
    expect(report.reasons.some((r) => r.includes("stop"))).toBe(true);
  });
});
