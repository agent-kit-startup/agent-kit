import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AgentBackend, BackendId, BackendRunOptions } from "./backends.js";
import { CLAUDE_SUBAGENT_MODEL_ENV } from "./model-roles.js";
import { runPlanLoop } from "./run-loop.js";

/** A one-to-do plan whose next to-do has worker_type docs-repo. */
async function workspace(extraFrontmatter = ""): Promise<{ root: string; plan: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-roles-loop-"));
  await mkdir(path.join(root, ".cursor", "plans"), { recursive: true });
  const plan = path.join(root, ".cursor", "plans", "roles-fixture.plan.md");
  await writeFile(
    plan,
    `---\nname: Roles fixture\n${extraFrontmatter}todos:\n  - id: one\n    status: pending\n    worker_type: docs-repo\n---\n`,
  );
  return { root, plan };
}

/** Records what the loop hands the backend, then completes the plan. */
function recordingBackend(id: BackendId, plan: string) {
  const seen: BackendRunOptions[] = [];
  const backend: AgentBackend = {
    id,
    resolve: async () => `/fake/${id}`,
    run: async (opts) => {
      seen.push(opts);
      const text = await readFile(plan, "utf8");
      await writeFile(plan, text.replace("status: pending", "status: completed"));
      await writeFile(opts.logPath, "");
      return {
        exitCode: 0,
        lastResult: {
          resultText: "done\nLOOP_TICK_RESULT: stop - plan exhausted",
          assistantTexts: [],
          isError: false,
          subtype: "success",
          errors: [],
          backgroundTasks: 0,
        },
      };
    },
  };
  return { backend, seen };
}

async function runOnce(
  backend: AgentBackend,
  root: string,
  roles: Parameters<typeof runPlanLoop>[0]["roles"],
  model?: string,
): Promise<string[]> {
  let out = "";
  const code = await runPlanLoop({
    root,
    maxTicks: 1,
    sleepSeconds: 0,
    dryRun: false,
    backend,
    ...(model ? { model } : {}),
    ...(roles ? { roles } : {}),
    events: { input: new PassThrough(), write: (t) => (out += t), writeErr: () => {} },
  });
  expect(code).toBe(0);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; message?: string })
    .filter((e) => e.type === "log")
    .map((e) => String(e.message));
}

describe("run-plan loop: model roles", () => {
  const roles = { subworker: { model: "sonnet", byWorkerType: { "docs-repo": "haiku" } } };

  it("claude ticks get the worker_type subworker model in the child env and log the roles", async () => {
    const { root, plan } = await workspace();
    const { backend, seen } = recordingBackend("claude", plan);
    const logs = await runOnce(
      backend,
      root,
      {
        roles: { ...roles, worker: { backend: "claude", model: "opus" } },
        backendSource: "config",
        modelSource: "config",
      },
      "opus",
    );
    expect(seen[0]?.env?.[CLAUDE_SUBAGENT_MODEL_ENV]).toBe("haiku");
    expect(seen[0]?.model).toBe("opus");
    expect(logs).toContain(
      "roles: worker claude (config), model opus (config), subworker haiku (worker_type)",
    );
  });

  it("a plan subworker_model beats the worker_type map", async () => {
    const { root, plan } = await workspace("subworker_model: opus\n");
    const { backend, seen } = recordingBackend("claude", plan);
    await runOnce(backend, root, { roles, backendSource: "default" });
    expect(seen[0]?.env?.[CLAUDE_SUBAGENT_MODEL_ENV]).toBe("opus");
  });

  it("other backends get no env and one warning", async () => {
    const { root, plan } = await workspace();
    const { backend, seen } = recordingBackend("cursor-agent", plan);
    const logs = await runOnce(backend, root, { roles, backendSource: "default" });
    expect(seen[0]?.env).toBeUndefined();
    expect(logs.filter((l) => l.includes("not supported on cursor-agent"))).toHaveLength(1);
  });

  it("without roles nothing changes (no env, no roles line)", async () => {
    const { root, plan } = await workspace("subworker_model: opus\n");
    const { backend, seen } = recordingBackend("claude", plan);
    const logs = await runOnce(backend, root, undefined, "m1");
    expect(seen[0]?.env).toBeUndefined();
    expect(seen[0]?.model).toBe("m1");
    expect(logs.some((l) => l.startsWith("roles:"))).toBe(false);
  });
});
