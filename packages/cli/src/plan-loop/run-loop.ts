import { mkdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../utils/fs.js";
import { logger } from "../utils/logger.js";
import type { AgentBackend } from "./backends.js";
import { countPendingTodos, findActivePlanFile, readPlan } from "./plan-state.js";
import { formatSentinelLine, parseSentinelFromLogFile } from "./sentinel.js";

export const TICK_PROMPT =
  '/run-plan - single tick from the headless runner (agent-kit run-plan). Read .cursor/HANDOFF.md and the active plan in .cursor/plans/. Mark the next to-do as in_progress in the frontmatter, execute ONLY that to-do, mark completed and update HANDOFF. If there is a commitable diff: run /git-staging without asking for confirmation. NEVER /git-prod. Do NOT re-arm an internal Loop skill - the external runner starts the next agent. End the response with exactly one line: "LOOP_TICK_RESULT: continue" if implementable to-dos remain, or "LOOP_TICK_RESULT: stop - <reason>" (plan exhausted, external blocker, or human decision needed).';

export interface RunPlanLoopOptions {
  root: string;
  maxTicks: number;
  sleepSeconds: number;
  model?: string;
  dryRun: boolean;
  backend: AgentBackend;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runPlanLoop(opts: RunPlanLoopOptions): Promise<number> {
  const plansDir = path.join(opts.root, ".cursor", "plans");
  const stopFile = path.join(opts.root, ".cursor", "loop.stop");
  const logDir = path.join(opts.root, ".cursor", "loop-logs");

  const planPath = await findActivePlanFile(plansDir);
  if (!planPath) {
    logger.error("No active plan in .cursor/plans/");
    return 1;
  }

  const pending = async () => countPendingTodos(await readPlan(planPath));

  await mkdir(logDir, { recursive: true });
  try {
    await unlink(stopFile);
  } catch {
    // absent is fine
  }

  const onSigInt = () => {
    console.log("");
    console.log("Loop interrupted (Ctrl+C). State saved in HANDOFF by the last tick.");
    process.exit(130);
  };
  process.on("SIGINT", onSigInt);

  try {
    console.log(`Active plan: ${path.basename(planPath)}`);
    console.log(`Pending to-dos: ${await pending()} | max ticks: ${opts.maxTicks}`);
    console.log(`Backend: ${opts.backend.id}`);

    if (opts.dryRun) {
      console.log("--dry-run: no agent will be started. Tick prompt:");
      console.log(TICK_PROMPT);
      return 0;
    }

    const binary = await opts.backend.resolve();
    if (!binary) {
      logger.error(`${opts.backend.id} not found on PATH`);
      return 1;
    }

    let tick = 0;
    while (true) {
      tick += 1;
      if (tick > opts.maxTicks) {
        console.log(`Budget of ${opts.maxTicks} ticks reached - stopping. Run again to continue.`);
        break;
      }

      if (await fileExists(stopFile)) {
        console.log(`Stop file found (${stopFile}) - stopping.`);
        try {
          await rm(stopFile, { force: true });
        } catch {
          // ignore
        }
        break;
      }

      const before = await pending();
      if (before === 0) {
        console.log("Plan exhausted (0 pending to-dos) - nothing to do.");
        break;
      }

      const logPath = path.join(logDir, `tick-${stamp()}.log`);
      const relLog = path.relative(opts.root, logPath);
      console.log("");
      console.log(`=== tick ${tick}/${opts.maxTicks} - pending: ${before} - log: ${relLog} ===`);

      let agentExit = 0;
      try {
        const result = await opts.backend.run({
          workspace: opts.root,
          prompt: TICK_PROMPT,
          model: opts.model,
          logPath,
        });
        agentExit = result.exitCode;
      } catch (err) {
        logger.error(String(err));
        return 1;
      }

      try {
        const logText = await readFile(logPath, "utf8");
        if (logText.includes("Too many MCP tools")) {
          console.log(
            "Too many MCP tools for the headless model - disable servers (cursor-agent mcp disable <id>) and run again.",
          );
          break;
        }
      } catch {
        // log may be missing if spawn failed early
      }

      if (agentExit !== 0) {
        console.log(
          `${opts.backend.id} exited with code ${agentExit} - stopping. See log: ${logPath}`,
        );
        break;
      }

      const sentinel = await parseSentinelFromLogFile(logPath);
      const after = await pending();

      if (sentinel.kind === "continue") {
        // ok
      } else if (sentinel.kind === "stop") {
        console.log(`Agent requested stop: ${formatSentinelLine(sentinel)}`);
        break;
      } else if (after < before) {
        console.log(
          `warn: tick without sentinel, but progress (${before} -> ${after}) - continuing.`,
        );
      } else {
        console.log(
          `Tick without sentinel and no progress (${before} -> ${after}) - stopping for safety.`,
        );
        break;
      }

      if (after === 0) {
        console.log("All to-dos completed. Suggesting /git-prod stays with the human (HITL).");
        break;
      }

      if (opts.sleepSeconds > 0) {
        await sleep(opts.sleepSeconds * 1000);
      }
    }

    console.log("");
    console.log(
      `Loop finished after ${tick} tick(s). Pending now: ${await pending()}. Logs in ${path.relative(opts.root, logDir)}/`,
    );
    return 0;
  } finally {
    process.off("SIGINT", onSigInt);
  }
}
