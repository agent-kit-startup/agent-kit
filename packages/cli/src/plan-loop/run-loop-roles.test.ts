import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AgentBackend, BackendId, BackendRunOptions } from "./backends.js";
import { CLAUDE_SUBAGENT_MODEL_ENV } from "./model-roles.js";
import type { RunReviewJobInput, RunReviewJobResult } from "./review-job.js";
import { runPlanLoop, type TickReviewSeams } from "./run-loop.js";

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

/** Two pending to-dos; each fake tick completes one and asks to continue. */
async function twoTodoWorkspace(): Promise<{ root: string; plan: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-kit-roles-review-"));
  await mkdir(path.join(root, ".cursor", "plans"), { recursive: true });
  const plan = path.join(root, ".cursor", "plans", "review-fixture.plan.md");
  await writeFile(
    plan,
    "---\nname: Review fixture\ntodos:\n  - id: one\n    status: pending\n  - id: two\n    status: pending\n---\n",
  );
  return { root, plan };
}

function steppingBackend(id: BackendId, plan: string) {
  const seen: BackendRunOptions[] = [];
  const backend: AgentBackend = {
    id,
    resolve: async () => `/fake/${id}`,
    run: async (opts) => {
      seen.push(opts);
      const text = await readFile(plan, "utf8");
      const next = text.replace("status: pending", "status: completed");
      await writeFile(plan, next);
      await writeFile(opts.logPath, "");
      const left = next.includes("status: pending");
      return {
        exitCode: 0,
        lastResult: {
          resultText: left
            ? "done\nLOOP_TICK_RESULT: continue"
            : "done\nLOOP_TICK_RESULT: stop - plan exhausted",
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

function reviewSeams(results: RunReviewJobResult[]): {
  seams: TickReviewSeams;
  calls: RunReviewJobInput[];
  detected: string[];
} {
  const calls: RunReviewJobInput[] = [];
  const detected: string[] = [];
  return {
    calls,
    detected,
    seams: {
      detect: async (requested) => {
        detected.push(requested);
        return {
          ok: true,
          id: requested === "auto" ? "cursor-agent" : (requested as BackendId),
          bin: `/fake/${requested}`,
        };
      },
      run: async (input) => {
        calls.push(input);
        return results[calls.length - 1] ?? { exitCode: 0, outcome: "clean" };
      },
    },
  };
}

async function runLoop(
  backend: AgentBackend,
  root: string,
  roles: NonNullable<Parameters<typeof runPlanLoop>[0]["roles"]>,
  seams: TickReviewSeams,
  model?: string,
): Promise<{ code: number; logs: string[] }> {
  let out = "";
  const code = await runPlanLoop({
    root,
    maxTicks: 5,
    sleepSeconds: 0,
    dryRun: false,
    backend,
    ...(model ? { model } : {}),
    roles,
    tickReview: seams,
    events: { input: new PassThrough(), write: (t) => (out += t), writeErr: () => {} },
  });
  const logs = out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; message?: string })
    .filter((e) => e.type === "log")
    .map((e) => String(e.message));
  return { code, logs };
}

describe("run-plan loop: reviewer role", () => {
  const tick = (model: string, backend?: "auto" | "claude" | "cursor-agent") => ({
    scope: "tick" as const,
    source: "roles" as const,
    model,
    ...(backend ? { backend } : {}),
  });

  it("scope tick reviews after each completed tick on the tick backend with the reviewer model", async () => {
    const { root, plan } = await twoTodoWorkspace();
    const { backend, seen } = steppingBackend("claude", plan);
    const { seams, calls, detected } = reviewSeams([]);
    const { code, logs } = await runLoop(
      backend,
      root,
      { roles: {}, backendSource: "config", modelSource: "config", reviewer: tick("fable") },
      seams,
      "claude-opus-5-5",
    );
    expect(code).toBe(0);
    expect(seen).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(detected).toEqual(["claude", "claude"]);
    expect(calls[0]).toMatchObject({ root, backendId: "claude", model: "fable", noHitl: true });
    // The review session reports its pid, so the lease and a host signal reach it.
    expect(typeof calls[0]?.onSpawn).toBe("function");
    expect(logs).toContain("roles: reviewer claude, model fable (scope tick) after tick 1");
  });

  it("findings landed by the review stop the loop before the next tick", async () => {
    const { root, plan } = await twoTodoWorkspace();
    const { backend, seen } = steppingBackend("claude", plan);
    const { seams, calls } = reviewSeams([{ exitCode: 0, outcome: "landed" }]);
    const { code, logs } = await runLoop(
      backend,
      root,
      { roles: {}, backendSource: "config", reviewer: tick("fable", "cursor-agent") },
      seams,
      "opus",
    );
    expect(code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.backendId).toBe("cursor-agent");
    expect(logs.some((l) => l.includes("Post-tick review landed a gate exit after tick 1"))).toBe(
      true,
    );
    expect(await readFile(plan, "utf8")).toContain("status: pending");
  });

  it("the identical model is refused once, never a silent self-review, and the loop goes on", async () => {
    const { root, plan } = await twoTodoWorkspace();
    const { backend, seen } = steppingBackend("claude", plan);
    const { seams, calls } = reviewSeams([]);
    const { code, logs } = await runLoop(
      backend,
      root,
      { roles: {}, backendSource: "config", reviewer: tick("opus") },
      seams,
      "claude-opus-5-5",
    );
    expect(code).toBe(0);
    expect(seen).toHaveLength(2);
    expect(calls).toHaveLength(0);
    expect(logs.filter((l) => l.includes("identical-model review is refused"))).toHaveLength(1);
  });

  it("a different model of the same family runs with one warning", async () => {
    const { root, plan } = await twoTodoWorkspace();
    const { backend } = steppingBackend("claude", plan);
    const { seams, calls } = reviewSeams([]);
    const { logs } = await runLoop(
      backend,
      root,
      { roles: {}, backendSource: "config", reviewer: tick("claude-opus-4-8") },
      seams,
      "claude-opus-5-5",
    );
    expect(calls).toHaveLength(2);
    expect(logs.filter((l) => l.includes("are the same family (opus)"))).toHaveLength(1);
  });

  it("scope plan and off run no post-tick review", async () => {
    for (const scope of ["plan", "off"] as const) {
      const { root, plan } = await twoTodoWorkspace();
      const { backend, seen } = steppingBackend("claude", plan);
      const { seams, calls } = reviewSeams([]);
      await runLoop(
        backend,
        root,
        {
          roles: {},
          backendSource: "config",
          reviewer: { scope, source: "roles", model: "fable" },
        },
        seams,
        "opus",
      );
      expect(seen, scope).toHaveLength(2);
      expect(calls, scope).toHaveLength(0);
    }
  });

  it("the exhaustion arm hands the launcher the tick model as the implementer stamp", async () => {
    const { root, plan } = await workspace();
    const scripts = path.join(root, ".cursor", "scripts");
    await mkdir(scripts, { recursive: true });
    const argsFile = path.join(root, "launcher-args.txt");
    const launcher = path.join(scripts, "plan-external-review.sh");
    await writeFile(
      launcher,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\n`,
    );
    await chmod(launcher, 0o755);
    const { backend } = recordingBackend("claude", plan);
    await runOnce(
      backend,
      root,
      { roles: {}, backendSource: "config", modelSource: "config" },
      "claude-opus-5-5",
    );
    expect((await readFile(argsFile, "utf8")).trim().split("\n")).toEqual([
      "--print",
      "--implementer-model",
      "claude-opus-5-5",
    ]);
  });
});
