import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_INVOCATION_DISABLED } from "../generator/claude-command-adapters.js";
import { L0_ARTIFACTS } from "../lifecycle/l0.js";
import { RUN_CATALOG } from "../plan-loop/dispatch.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");

function readRel(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const command = readRel(".cursor/commands/cancel-plan.md");
const ASK_LABELS = "`Cancel active plan [plan-file]` / `Keep the active plan`";

/** The in-flight process pattern exactly as the command prints it. */
function runProcessPattern(): RegExp {
  const m = /matching `([^`]+)` whose `--cwd`/.exec(command);
  if (!m?.[1]) throw new Error("cancel-plan.md lost its run-plan process pattern");
  return new RegExp(m[1]);
}

describe("docs-contract: /cancel-plan cancels the active plan only", () => {
  it("ships as L0 with a Claude adapter that the model cannot invoke on its own", () => {
    expect(L0_ARTIFACTS.map((a) => a.target)).toContain(".cursor/commands/cancel-plan.md");
    expect(MODEL_INVOCATION_DISABLED.has("cancel-plan")).toBe(true);
    expect((RUN_CATALOG as readonly string[]).includes("cancel-plan")).toBe(true);
    const adapter = readRel(".claude/commands/cancel-plan.md");
    expect(adapter).toContain("disable-model-invocation: true");
    expect(adapter).toContain("Read `.cursor/commands/cancel-plan.md` now");
  });

  it("asks with the same labels and ask-id as the hitl-gates table", () => {
    const gates = readRel(".cursor/skills/core/hitl-gates/SKILL.md");
    expect(command).toContain(`Options: ${ASK_LABELS}`);
    expect(command).toContain("ask-id `cancel-plan`");
    expect(gates).toContain(`| \`/cancel-plan\` | Id \`cancel-plan\`: ${ASK_LABELS} |`);
    expect(gates).toMatch(/`backlog-write`, `cancel-plan`, `ticket`\)/);
  });

  it("keeps the file, clears the active fields and never touches the queue or picks a plan", () => {
    expect(command).toContain("set `- **Plan:** none`");
    expect(command).toContain("Do not move the file to `archive/`");
    expect(command).toContain("agent-kit plan-index");
    for (const field of ["Backlog plans", "Parked plans", "Run queue", "Queue status"]) {
      expect(command).toContain(`\`- **${field}:**\``);
    }
    expect(command).toContain("Do not activate another plan or promote a Backlog row");
  });

  it("refuses a running plan: the process pattern matches the CLI and Colony engine only", () => {
    const re = runProcessPattern();
    const hits = [
      "node /home/u/.local/share/colony/engine/6.12.0/dist/index.js run-plan --events ndjson --backend claude --cwd /home/u/repo",
      "node /usr/lib/node_modules/@dadado/agent-kit-cli/dist/index.js run-plan-all --cwd /w",
      "agent-kit run-plan",
    ];
    const misses = [
      "agent-kit run /cancel-plan colony.plan.md",
      "claude -p --output-format stream-json",
      "agent-kit run-plans-report",
    ];
    for (const line of hits) expect(re.test(line), line).toBe(true);
    for (const line of misses) expect(re.test(line), line).toBe(false);
    expect(command).toContain("`- **Queue status:**` starts with `running`");
  });

  it("leaves /backlog-cancel on Backlog rows and points it to /cancel-plan", () => {
    const backlogCancel = readRel(".cursor/commands/backlog-cancel.md");
    expect(backlogCancel).toContain("**stop** and point to `/cancel-plan`");
    expect(backlogCancel).toContain("| `/cancel-plan` |");
  });
});
