import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLI_HELP_GROUPS } from "../welcome/help-groups.js";
import { queueCommand, renderQueueGates } from "./queue.js";

const HANDOFF = [
  "- **Queue status:** exhausted (deferred: a.plan.md -> Ask a-accept)",
  "- **Queue outcomes:**",
  "  a.plan.md: deferred-operator (gate: Ask a-accept + operator merges Colony #64 (gh pr merge 64))",
  "  b.plan.md: completed",
  "",
].join("\n");

describe("renderQueueGates", () => {
  it("json is the decideQueueEndGatesAsk decision over the HANDOFF rows", () => {
    const decision = JSON.parse(renderQueueGates(HANDOFF, "json"));
    expect(decision).toEqual({
      ask: true,
      reason: "deferred_gates",
      labels: ["Resolve gates now", "Print resolution prompt", "Later"],
      gates: [
        {
          plan: "a.plan.md",
          gate: "Ask a-accept + operator merges Colony #64 (gh pr merge 64)",
          asks: ["a-accept"],
        },
      ],
    });
  });

  it("prompt is formatQueueEndResolutionPrompt; empty when nothing is deferred", () => {
    expect(renderQueueGates(HANDOFF, "prompt", "openrouter")).toBe(
      [
        "agent-kit run-plan-all --backend openrouter",
        "",
        "Re-probe the deferred-operator rows first. Operator steps done since the last run:",
        "- a.plan.md: Ask a-accept + operator merges Colony #64 (gh pr merge 64) (open Asks: a-accept)",
        "",
      ].join("\n"),
    );
    expect(renderQueueGates("", "prompt")).toBe("");
    expect(JSON.parse(renderQueueGates("", "json"))).toMatchObject({ ask: false, gates: [] });
  });

  it("text lists the gates and the relaunch line", () => {
    const text = renderQueueGates(HANDOFF, "text");
    expect(text).toContain("Deferred operator gates (1):");
    expect(text).toContain("open Asks: a-accept");
    expect(text).toContain("agent-kit run-plan-all --note @note.md");
    expect(renderQueueGates("", "text")).toBe(
      "No deferred operator gates in HANDOFF Queue outcomes.\n",
    );
  });
});

describe("agent-kit queue gates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("reads HANDOFF from --cwd and prints JSON; never writes HANDOFF", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-queue-gates-"));
    await mkdir(path.join(root, ".cursor"), { recursive: true });
    await writeFile(path.join(root, ".cursor", "HANDOFF.md"), HANDOFF, "utf8");
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    const gates = (
      queueCommand.subCommands as Record<
        string,
        { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }
      >
    ).gates;
    expect(gates).toBeDefined();
    await gates?.run({ args: { json: true, prompt: false, backend: "claude", cwd: root } });
    expect(JSON.parse(out).gates[0].plan).toBe("a.plan.md");
  });

  it("is listed in the MISSION help group", () => {
    const mission = CLI_HELP_GROUPS.find((g) => g.id === "mission");
    expect(mission?.commands).toContain("queue");
  });
});
