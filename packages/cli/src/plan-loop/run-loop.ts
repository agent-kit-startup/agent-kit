import { readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { shouldUseLiveTui, withLiveTui } from "../mission-control/live-run.js";
import { fileExists } from "../utils/fs.js";
import { STATE_ROOT_ENV, ensureLoopLogsDir, runnerStatePaths } from "../utils/kit-paths.js";
import { logger } from "../utils/logger.js";
import { TtySpinner, shouldUseVisualMotion, withCliProgress } from "../welcome/visual-kit.js";
import type { AgentBackend } from "./backends.js";
import {
  DRIVER_PROTOCOL_VERSION,
  DriverAgentSink,
  type DriverAnswerReader,
  type DriverEmitter,
  type DriverEvent,
  type DriverTickSentinel,
  createDriverAnswerReader,
  createDriverEmitter,
} from "./driver-events.js";
import {
  armExternalPlanReview,
  isPlanExhaustedReason,
  shouldArmExternalPlanReview,
} from "./external-review.js";
import {
  type HitlReplyStamp,
  type HitlStop,
  type TurnResult,
  formatHitlSummary,
} from "./hitl-relay.js";
import { createPersonaBannerPrinter, loadCliRunPlanPersona } from "./persona-banners.js";
import { countPendingTodos, readPlan, resolveActivePlanPath } from "./plan-state.js";
import {
  type TickSentinel,
  formatSentinelLine,
  resolveTickResultStatus,
  resolveTickSentinel,
} from "./sentinel.js";
import { type UsageLimitHit, detectUsageLimit } from "./usage-limit.js";

export const TICK_PROMPT =
  '/run-plan - single tick from the headless runner (agent-kit run-plan). Read .cursor/HANDOFF.md and the active plan in .cursor/plans/. Mark the next to-do as in_progress in the frontmatter, execute ONLY that to-do, mark completed and update HANDOFF. If there is a commitable diff: run /git-staging without asking for confirmation. NEVER /git-prod. Do NOT re-arm an internal Loop skill - the external runner starts the next agent. End the response with exactly one line: "LOOP_TICK_RESULT: continue" if implementable to-dos remain, or "LOOP_TICK_RESULT: stop - <reason>" (plan exhausted, external blocker, or human decision needed).';

export interface RunPlanLoopOptions {
  root: string;
  maxTicks: number;
  sleepSeconds: number;
  model?: string;
  dryRun: boolean;
  backend: AgentBackend;
  /** `--no-hitl`: a gate inside a tick stops the loop (exit 4) instead of prompting. */
  noHitl?: boolean;
  /** `--plain`: status lines instead of the Mission Control live view on a TTY. */
  plain?: boolean;
  /**
   * `--on-limit <backend>`: when a tick stops on a vendor usage limit, the
   * next fresh tick runs on this backend instead of stopping (once per run,
   * only when it resolves on PATH). Absent = the limit stops the run.
   */
  onLimit?: AgentBackend;
  /**
   * `--events ndjson`: driver mode. stdout carries only NDJSON events and HITL
   * answers are read as JSON lines from stdin (no TTY needed); see
   * driver-events.ts and docs/driver-events-protocol.md. Absent = today's
   * terminal behavior.
   */
  events?: DriverRunOptions;
}

/** Driver-mode seams (defaults: process.stdin / process.stdout / process.stderr). */
export interface DriverRunOptions {
  input?: NodeJS.ReadableStream;
  /** NDJSON event writer (stdout). */
  write?: (text: string) => void;
  /** Human-oriented side channel (gate prompt text, external-review launcher output). */
  writeErr?: (text: string) => void;
  now?: () => Date;
}

/** Driver-mode state for one run. */
interface DriverRun {
  emitter: DriverEmitter;
  reader: DriverAnswerReader;
  writeErr: (text: string) => void;
}

function driverSentinel(sentinel: TickSentinel | null): DriverTickSentinel | null {
  if (!sentinel) return null;
  const line = formatSentinelLine(sentinel);
  return {
    kind: sentinel.kind,
    ...(sentinel.kind === "stop" ? { reason: sentinel.reason } : {}),
    line: line || null,
  };
}

/**
 * Run one tick under the TTY spinner, pausing it while the relay prompts the
 * operator so the numbered list is not repainted over. No motion: plain call.
 */
async function runTickWithSpinner(
  label: string,
  backend: AgentBackend,
  opts: Parameters<AgentBackend["run"]>[0],
  plain: boolean,
): Promise<Awaited<ReturnType<AgentBackend["run"]>>> {
  if (shouldUseLiveTui({ plain })) {
    return withLiveTui(
      {
        root: opts.workspace,
        backend: backend.id,
        logPath: opts.logPath,
        noHitl: opts.hitl?.policy === "off",
      },
      (seams) =>
        backend.run({
          ...opts,
          hitl: seams.hitl,
          render: seams.render,
          onSpawn: seams.onSpawn,
          log: seams.log,
        }),
    );
  }
  if (!shouldUseVisualMotion()) return backend.run(opts);
  const spinner = new TtySpinner({ motion: true });
  spinner.start(label);
  try {
    return await backend.run({
      ...opts,
      hitl: {
        ...opts.hitl,
        onPromptStart: () => spinner.stop(),
        onPromptEnd: () => spinner.start(label),
      },
    });
  } finally {
    spinner.stop();
  }
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
  // Runner-owned files (`loop-logs/`, `loop.stop`) follow AGENT_KIT_STATE_ROOT
  // (`.cursor` by default, or `.agent-kit`); plans and HANDOFF stay in `.cursor/`.
  const statePaths = runnerStatePaths(opts.root);
  const stopFile = statePaths.stopFile;
  const logDir = statePaths.loopLogsDir;

  let tick = 0;
  /** Ticks that actually started an agent (`tick` also counts the attempt that hit a stop). */
  let ticksRun = 0;
  const driver: DriverRun | null = opts.events
    ? (() => {
        const emitter = createDriverEmitter(opts.events.write, opts.events.now);
        return {
          emitter,
          reader: createDriverAnswerReader({
            input: opts.events.input,
            emitter,
            tick: () => tick,
          }),
          writeErr:
            opts.events.writeErr ??
            ((text: string) => {
              process.stderr.write(text);
            }),
        };
      })()
    : null;
  // Every human-oriented line goes through here: a `log` event in driver
  // mode (stdout stays NDJSON only), the console otherwise.
  const say = (message: string, level: "info" | "warn" | "error" = "info") => {
    if (driver) driver.emitter.emit({ type: "log", level, message });
    else if (level === "error") logger.error(message);
    else console.log(message);
  };
  const emit = (event: DriverEvent) => driver?.emitter.emit(event);
  const finishRun = (
    exitCode: number,
    reason: string,
    pending: number | null,
    planExhausted = false,
  ): number => {
    emit({ type: "run_end", exitCode, ticks: ticksRun, pending, reason, planExhausted });
    driver?.reader.close();
    return exitCode;
  };

  const planPath = await resolveActivePlanPath(opts.root);
  if (!planPath) {
    say("No active plan in .cursor/plans/", "error");
    return finishRun(1, "no active plan", null);
  }

  const pending = async () => countPendingTodos(await readPlan(planPath));
  if (statePaths.invalid !== undefined) {
    say(
      `${STATE_ROOT_ENV}=${statePaths.invalid} is not supported (use .cursor or .agent-kit); using .cursor.`,
      "warn",
    );
  }

  await ensureLoopLogsDir(statePaths);
  try {
    await unlink(stopFile);
  } catch {
    // absent is fine
  }

  const onSigInt = () => {
    if (driver) {
      emit({
        type: "run_end",
        exitCode: 130,
        ticks: ticksRun,
        pending: null,
        reason: "interrupted (SIGINT)",
        planExhausted: false,
      });
    } else {
      console.log("");
      console.log("Loop interrupted (Ctrl+C). State saved in HANDOFF by the last tick.");
    }
    process.exit(130);
  };
  process.on("SIGINT", onSigInt);

  try {
    // Fail soft: missing persona.json keeps plain console.log (no crash).
    // Driver mode has no persona chrome: stdout is the event stream.
    const persona = driver ? null : await loadCliRunPlanPersona(opts.root);
    const banners = createPersonaBannerPrinter(persona);

    const pendingAtStart = await pending();
    emit({
      type: "run_start",
      protocol: DRIVER_PROTOCOL_VERSION,
      backend: opts.backend.id,
      plan: path.basename(planPath),
      pending: pendingAtStart,
      maxTicks: opts.maxTicks,
      hitl: opts.noHitl ? "off" : "driver",
    });
    say(`Active plan: ${path.basename(planPath)}`);
    say(`Pending to-dos: ${pendingAtStart} | max ticks: ${opts.maxTicks}`);
    say(`Backend: ${opts.backend.id}`);
    if (persona) {
      say(`CLI persona: ${persona.displayName ?? persona.id}`);
    }

    if (opts.dryRun) {
      say("--dry-run: no agent will be started. Tick prompt:");
      say(TICK_PROMPT);
      return finishRun(0, "dry-run", pendingAtStart);
    }

    const binary = await opts.backend.resolve();
    if (!binary) {
      say(`${opts.backend.id} not found on PATH`, "error");
      return finishRun(1, `${opts.backend.id} not found on PATH`, pendingAtStart);
    }

    let stopReason: string | undefined;
    let planExhausted = false;
    let exitCode = 0;
    let endReason = "";
    // `--on-limit`: the backend may change between fresh ticks, once, when a
    // tick stops on a vendor usage limit (same plan, same tick prompt).
    let backend = opts.backend;
    let limitSwitched = false;

    while (true) {
      tick += 1;
      if (tick > opts.maxTicks) {
        const msg = `Budget of ${opts.maxTicks} ticks reached - stopping. Run again to continue.`;
        if (banners) banners.stop(msg);
        else say(msg);
        endReason = `budget of ${opts.maxTicks} ticks reached`;
        break;
      }

      if (await fileExists(stopFile)) {
        const msg = `Stop file found (${stopFile}) - stopping.`;
        if (banners) banners.stop(msg);
        else say(msg);
        endReason = "stop file found";
        try {
          await rm(stopFile, { force: true });
        } catch {
          // ignore
        }
        break;
      }

      const before = await pending();
      if (before === 0) {
        say("Plan exhausted (0 pending to-dos) - nothing to do.");
        planExhausted = true;
        endReason = "plan exhausted";
        break;
      }

      const logPath = path.join(logDir, `tick-${stamp()}.log`);
      const relLog = path.relative(opts.root, logPath);
      if (!driver) console.log("");
      const tickLine = `=== tick ${tick}/${opts.maxTicks} - pending: ${before} - log: ${relLog} ===`;
      if (banners) banners.tickStart(tickLine);
      else say(tickLine);
      ticksRun = tick;
      emit({
        type: "tick_start",
        tick,
        maxTicks: opts.maxTicks,
        pending: before,
        log: relLog,
        prompt: TICK_PROMPT,
        backend: backend.id,
      });

      let agentExit = 0;
      let hitlStop: HitlStop | undefined;
      let lastResult: TurnResult | undefined;
      let replies: HitlReplyStamp[] = [];
      let limit: UsageLimitHit | null = null;
      const endTick = (pendingAfter: number | null, sentinel: TickSentinel | null) =>
        emit({
          type: "tick_end",
          tick,
          backend: backend.id,
          limit,
          exitCode: agentExit,
          pendingBefore: before,
          pendingAfter,
          result: driverSentinel(sentinel),
          replies: replies.map(({ askId, reply, label, line, at }) => ({
            askId,
            reply,
            label,
            line,
            at,
          })),
          stop: hitlStop
            ? {
                askId: hitlStop.askId,
                cause: hitlStop.cause,
                message: hitlStop.message,
                exitCode: hitlStop.exitCode,
              }
            : null,
        });
      try {
        const runOpts: Parameters<AgentBackend["run"]>[0] = {
          workspace: opts.root,
          prompt: TICK_PROMPT,
          model: opts.model,
          logPath,
          hitl: { policy: opts.noHitl ? "off" : "prompt" },
        };
        const result = driver
          ? await backend.run({
              ...runOpts,
              log: (line) => say(line),
              render: new DriverAgentSink(driver.emitter, tick),
              hitl: {
                policy: opts.noHitl ? "off" : "driver",
                readAnswer: driver.reader.read,
                write: driver.writeErr,
              },
            })
          : await runTickWithSpinner(`tick ${tick}`, backend, runOpts, opts.plain === true);
        agentExit = result.exitCode;
        for (const line of formatHitlSummary(result.hitl)) say(line);
        hitlStop = result.hitl?.stop;
        replies = result.hitl?.replies ?? [];
        lastResult = result.lastResult;
      } catch (err) {
        say(String(err), "error");
        agentExit = 1;
        endTick(null, null);
        return finishRun(1, `tick ${tick} failed to start: ${String(err)}`, await pending());
      }

      // A tick that ended at a gate with no reply is a stop, not a tick
      // without sentinel: the operator (or --no-hitl) decided, and the record
      // above says so. Never a default answer.
      if (hitlStop) {
        const msg = `${backend.id} tick ended at a HITL gate without a reply - stopping. See log: ${relLog}`;
        if (banners) {
          banners.tickEnd("hitl stop");
          banners.stop(msg);
        } else {
          say(msg);
        }
        endTick(await pending(), null);
        exitCode = hitlStop.exitCode;
        endReason = hitlStop.message;
        break;
      }

      let logText = "";
      try {
        logText = await readFile(logPath, "utf8");
      } catch {
        // log may be missing if spawn failed early
      }

      // A vendor usage limit is its own stop, named as such (not "tick
      // failed"): the plan is unchanged and a fresh tick can resume it, on
      // this backend after the reset or on another one (`--on-limit`).
      limit = detectUsageLimit(logText);
      if (limit) {
        const hit = limit;
        const fallback =
          opts.onLimit && !limitSwitched && opts.onLimit.id !== backend.id ? opts.onLimit : null;
        const fallbackBin = fallback ? await fallback.resolve() : null;
        endTick(await pending(), null);
        if (fallback && fallbackBin) {
          const msg = `${backend.id} stopped on a usage limit (${hit.detail}); next tick continues the plan on ${fallback.id} (--on-limit). See log: ${relLog}`;
          if (banners) banners.tickEnd("usage limit");
          say(msg, "warn");
          backend = fallback;
          limitSwitched = true;
          continue;
        }
        const why = fallback ? ` (--on-limit ${fallback.id} not found on PATH)` : "";
        const msg = `${backend.id} stopped on a usage limit (${hit.detail})${why} - stopping. The plan is unchanged: run again after the reset, or with --backend <other>. See log: ${relLog}`;
        if (banners) {
          banners.tickEnd("usage limit");
          banners.stop(msg);
        } else {
          say(msg);
        }
        endReason = `usage-limit: ${backend.id}`;
        break;
      }

      if (logText.includes("Too many MCP tools")) {
        const msg =
          "Too many MCP tools for the headless model - disable servers (cursor-agent mcp disable <id>) and run again.";
        if (banners) banners.stop(msg);
        else say(msg);
        endTick(await pending(), null);
        endReason = "too many MCP tools";
        break;
      }

      // A stream-json result with is_error names the real cause (auth, gateway,
      // max-turns) whether the CLI exited 0 or not; without it the tick would
      // stop as "no sentinel" or "exited with code N" and the cause would sit
      // only in the log. The log is already redacted, so quoting it is safe.
      // The relay's watched result is the same text; the file is the fallback.
      const status = await resolveTickResultStatus(lastResult, logPath);
      if (status?.isError) {
        const detail = status.errors[0] ? `: ${status.errors[0].split("\n")[0]}` : "";
        const msg = `${backend.id} tick failed (${status.subtype ?? "is_error"}${detail}) - stopping. See log: ${relLog}`;
        if (banners) {
          banners.tickEnd(status.subtype ?? "is_error");
          banners.stop(msg);
        } else {
          say(msg);
        }
        endTick(await pending(), null);
        endReason = `tick failed (${status.subtype ?? "is_error"})`;
        break;
      }

      if (agentExit !== 0) {
        const msg = `${backend.id} exited with code ${agentExit} - stopping. See log: ${relLog}`;
        if (banners) {
          banners.tickEnd(`exit ${agentExit}`);
          banners.stop(msg);
        } else {
          say(msg);
        }
        endTick(await pending(), null);
        endReason = `${backend.id} exited with code ${agentExit}`;
        break;
      }

      const sentinel = await resolveTickSentinel(lastResult, logPath);
      const after = await pending();

      if (banners) {
        banners.tickEnd(`pending: ${after}`);
      }
      endTick(after, sentinel);

      if (sentinel.kind === "continue") {
        // ok
      } else if (sentinel.kind === "stop") {
        say(`Agent requested stop: ${formatSentinelLine(sentinel)}`);
        stopReason = sentinel.reason;
        endReason = `agent requested stop: ${sentinel.reason}`;
        if (after === 0 || isPlanExhaustedReason(sentinel.reason)) {
          planExhausted = true;
        }
        break;
      } else if (after < before) {
        say(
          `warn: tick without sentinel, but progress (${before} -> ${after}) - continuing.`,
          "warn",
        );
      } else {
        const msg = `Tick without sentinel and no progress (${before} -> ${after}) - stopping for safety.`;
        if (banners) banners.stop(msg);
        else say(msg);
        endReason = "tick without sentinel and no progress";
        break;
      }

      if (after === 0) {
        say("All to-dos completed. Suggesting /git-prod stays with the human (HITL).");
        planExhausted = true;
        endReason = "plan exhausted";
        break;
      }

      if (opts.sleepSeconds > 0) {
        if (banners) banners.sleep(opts.sleepSeconds);
        if (driver) await sleep(opts.sleepSeconds * 1000);
        else
          await withCliProgress(`sleep ${opts.sleepSeconds}s`, () =>
            sleep(opts.sleepSeconds * 1000),
          );
      }
    }

    const pendingNow = await pending();
    if (!driver) console.log("");
    const finishDetail = `after ${tick} tick(s); pending: ${pendingNow}`;
    if (banners) banners.phaseComplete(finishDetail);
    say(
      `Loop finished after ${tick} tick(s). Pending now: ${pendingNow}. Logs in ${path.relative(opts.root, logDir)}/`,
    );

    // Optional external review: only on plan exhausted. Script owns opt-in / missing claude.
    // Never fails the loop; never /git-prod; not a Cursor stop hook.
    if (planExhausted || shouldArmExternalPlanReview({ pending: pendingNow, stopReason })) {
      // Prefer pending===0; planExhausted covers sentinel "plan exhausted" before status catch-up.
      await armExternalPlanReview(
        opts.root,
        driver ? { log: (line) => say(line), writeOut: driver.writeErr } : {},
      );
    }

    return finishRun(exitCode, endReason || "stopped", pendingNow, planExhausted);
  } finally {
    process.off("SIGINT", onSigInt);
  }
}
