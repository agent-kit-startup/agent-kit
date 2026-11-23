import { readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { shouldUseLiveTui, withLiveTui } from "../mission-control/live-run.js";
import { fileExists } from "../utils/fs.js";
import { ensureLoopLogsDir, runnerStatePaths, STATE_ROOT_ENV } from "../utils/kit-paths.js";
import { logger } from "../utils/logger.js";
import { shouldUseVisualMotion, TtySpinner, withCliProgress } from "../welcome/visual-kit.js";
import type { AgentBackend, BackendId } from "./backends.js";
import { type DetectResult, detectAgentBackend } from "./detect.js";
import {
  createDriverAnswerReader,
  createDriverEmitter,
  DRIVER_PROTOCOL_VERSION,
  DriverAgentSink,
  type DriverAnswerReader,
  type DriverEmitter,
  type DriverEvent,
  type DriverTickSentinel,
  type DriverUsage,
  driverReplies,
  driverStop,
  STOPPED_BY_REQUEST_REASON,
} from "./driver-events.js";
import {
  armExternalPlanReview,
  isPlanExhaustedReason,
  shouldArmExternalPlanReview,
} from "./external-review.js";
import { classifyGateExit, type GateExitOutcome, landGateExit } from "./gate-exit.js";
import {
  formatHitlSummary,
  type HitlReplyStamp,
  type HitlStop,
  type TurnResult,
} from "./hitl-relay.js";
import {
  CLAUDE_SUBAGENT_MODEL_ENV,
  describeIdenticalReviewModel,
  describeResolvedRoles,
  describeSameFamilyReviewModel,
  type ModelRoles,
  type ResolvedReviewer,
  type RoleSource,
  readPlanRoleOverrides,
  resolveSubworkerModel,
  reviewModelRelation,
} from "./model-roles.js";
import { createPersonaBannerPrinter, loadCliRunPlanPersona } from "./persona-banners.js";
import { countPendingTodos, readPlan, resolveActivePlanPath } from "./plan-state.js";
import {
  acquirePlanWriterLease,
  forwardTermination,
  gateCheckIn,
  holdQueueStatus,
  type NestedLeaseProbe,
  procStart,
  QUEUE_LEASE_INTERRUPT_WAIT_MS,
  QUEUE_LEASE_SESSION_ENV,
  type QueueLeaseEnv,
  type QueueLeaseHandle,
  type QueueLeaseProc,
} from "./queue-lease.js";
import {
  REVIEW_BACKENDS,
  type RunReviewJobInput,
  type RunReviewJobResult,
  runReviewJob,
} from "./review-job.js";
import {
  formatSentinelLine,
  resolveTickResultStatus,
  resolveTickSentinel,
  type TickSentinel,
} from "./sentinel.js";
import { sumUsage } from "./token-usage.js";
import { detectUsageLimit, type UsageLimitHit } from "./usage-limit.js";

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
  /**
   * `--land-on-gate` (config key `landOnGate`): when the run ends at an
   * unanswered gate, as `stopped-by-operator`, or as a failure, land the
   * outcome on a `gate-exit/<UTC stamp>` branch (gate-exit.ts). Off by default.
   */
  landOnGate?: boolean;
  /** Test seam for the landing step (defaults: the real git / gh / glab). */
  gateExit?: Partial<Omit<Parameters<typeof landGateExit>[0], "root" | "outcome">>;
  /**
   * Model roles (ADR 2026-11-16 model roles): the parsed config `roles` and
   * where the worker backend and model came from. Present = each tick logs
   * the resolved roles and the claude backend gets the subworker model.
   * Absent = no roles logic (callers that predate the key).
   */
  roles?: RunRolesOptions;
  /** Test seam for the post-tick review (`roles.reviewer.scope: "tick"`). */
  tickReview?: TickReviewSeams;
  /**
   * Test seam: plan-writer lease clock, liveness, host and ancestry
   * (queue-lease.ts). The loop holds the workspace lease for the whole run, or
   * runs under the holder's lease when it is a subsession of it.
   */
  lease?: QueueLeaseEnv & { nested?: NestedLeaseProbe };
}

export interface RunRolesOptions {
  roles: ModelRoles;
  backendSource: RoleSource;
  modelSource?: RoleSource;
  /**
   * The resolved reviewer role (`loadRolesContext`). Scope `tick` runs the
   * review job after each completed tick; absent = no per-tick review.
   */
  reviewer?: ResolvedReviewer;
}

/** Test seams for the post-tick review (defaults: PATH detection and the real review job). */
export interface TickReviewSeams {
  detect?: (requested: string) => Promise<DetectResult>;
  run?: (input: RunReviewJobInput) => Promise<RunReviewJobResult>;
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
          hitl: { ...seams.hitl, checkIn: opts.hitl?.checkIn },
          render: seams.render,
          onSpawn: (info) => {
            opts.onSpawn?.(info);
            seams.onSpawn(info);
          },
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
  // Driver protocol 1.3.0: the run's usage is the sum of the ticks' (each tick is its own session).
  let runUsage: DriverUsage | null = null;
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
  // Gate exit inputs, filled as the loop runs.
  let landStop: HitlStop | undefined;
  let landFailed = false;
  let landLogPath: string | undefined;
  let landSummary: string | undefined;
  let landGateText: string | undefined;
  let landBackend = opts.backend.id;
  let landPlan: string | undefined;
  /** Opt-in landing; never changes the exit code, never answers the gate. */
  const landIfNeeded = async (exitCode: number, reason: string, pendingNow: number | null) => {
    if (!opts.landOnGate || opts.dryRun) return;
    const trigger = classifyGateExit({ stop: landStop, failed: landFailed });
    if (!trigger) return;
    const outcome: GateExitOutcome = {
      trigger,
      exitCode,
      reason,
      command: "run-plan",
      backend: landBackend,
      ticks: ticksRun,
      pending: pendingNow,
      ...(landPlan ? { plan: landPlan } : {}),
      ...(landStop ? { askId: landStop.askId } : {}),
      ...(landLogPath ? { logPath: landLogPath } : {}),
      ...(landSummary ? { summary: landSummary } : {}),
      ...(landGateText ? { gateText: landGateText } : {}),
    };
    try {
      await landGateExit({
        ...opts.gateExit,
        root: opts.root,
        outcome,
        log: (line) => say(line, "warn"),
      });
    } catch (err) {
      say(`gate-exit: landing failed: ${String(err)}`, "warn");
    }
  };
  const finishRun = (
    exitCode: number,
    reason: string,
    pending: number | null,
    planExhausted = false,
  ): number => {
    emit({
      type: "run_end",
      exitCode,
      ticks: ticksRun,
      pending,
      reason,
      planExhausted,
      usage: runUsage,
    });
    driver?.reader.close();
    return exitCode;
  };

  const planPath = await resolveActivePlanPath(opts.root);
  if (!planPath) {
    say("No active plan in .cursor/plans/", "error");
    return finishRun(1, "no active plan", null);
  }

  const pending = async () => countPendingTodos(await readPlan(planPath));
  landPlan = path.basename(planPath);
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

  // Plan-writer lease (ADR 2026-07-26 Amend 2026-11-16 agent check-in): held
  // for the whole run, or joined as a subsession of the holder.
  let lease: QueueLeaseHandle | null = null;
  let nestedSession: string | null = null;
  // Check in before each gate: another live session holding the lease means the gate is not offered.
  const checkIn = gateCheckIn(opts.root, () => lease?.session ?? nestedSession, opts.lease);
  let restoreQueue: (() => boolean) | null = null;
  let previousLeaseSession: string | undefined;
  let leaseSessionSet = false;
  const releaseLease = (interrupted: boolean) => {
    restoreQueue?.();
    restoreQueue = null;
    if (interrupted) lease?.releaseAfterAgent(QUEUE_LEASE_INTERRUPT_WAIT_MS);
    else lease?.release();
    if (leaseSessionSet) {
      if (previousLeaseSession === undefined) delete process.env[QUEUE_LEASE_SESSION_ENV];
      else process.env[QUEUE_LEASE_SESSION_ENV] = previousLeaseSession;
      leaseSessionSet = false;
    }
  };

  const onSigInt = () => {
    releaseLease(true);
    if (driver) {
      emit({
        type: "run_end",
        exitCode: 130,
        ticks: ticksRun,
        pending: null,
        reason: "interrupted (SIGINT)",
        planExhausted: false,
        usage: runUsage,
      });
    } else {
      console.log("");
      console.log("Loop interrupted (Ctrl+C). State saved in HANDOFF by the last tick.");
    }
    process.exit(130);
  };
  process.on("SIGINT", onSigInt);
  // Driver mode (an app such as Colony): SIGTERM / SIGHUP, the host's
  // parent-death signal included, reach the running tick's agent before this
  // process exits, so no agent outlives its host.
  let tickAgent: QueueLeaseProc | null = null;
  const offTermination = driver
    ? forwardTermination(
        () => tickAgent,
        (signal) => {
          releaseLease(true);
          emit({
            type: "run_end",
            exitCode: 130,
            ticks: ticksRun,
            pending: null,
            reason: `interrupted (${signal})`,
            planExhausted: false,
            usage: runUsage,
          });
          process.exit(130);
        },
      )
    : () => {};

  try {
    // Fail soft: missing persona.json keeps plain console.log (no crash).
    // Driver mode has no persona chrome: stdout is the event stream.
    const persona = driver ? null : await loadCliRunPlanPersona(opts.root);
    const banners = createPersonaBannerPrinter(persona);

    const pendingAtStart = await pending();
    emit({
      type: "run_start",
      protocol: DRIVER_PROTOCOL_VERSION,
      command: "run-plan",
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

    const writer = acquirePlanWriterLease(opts.root, "agent-kit run-plan", {
      ...opts.lease,
      onLost: (by) =>
        say(
          `Queue lease lost: ${by ? `session ${by.session} (pid ${by.dispatcher.pid})` : "the lease file"} replaced this run's lease. Another session may be writing this workspace's plans.`,
          "warn",
        ),
    });
    if (writer.kind === "refused") {
      say(writer.message, "error");
      return finishRun(1, writer.message, pendingAtStart);
    }
    if (writer.kind === "nested") {
      nestedSession = writer.lease.session;
      say(
        `Queue lease: running under session ${writer.lease.session} (dispatcher pid ${writer.lease.dispatcher.pid}).`,
      );
    } else {
      lease = writer.handle;
      if (lease.takeover) {
        say(
          `Queue lease: took over a stale lease (${lease.takeover.reason}); the takeover is logged in HANDOFF.`,
          "warn",
        );
      }
      previousLeaseSession = process.env[QUEUE_LEASE_SESSION_ENV];
      process.env[QUEUE_LEASE_SESSION_ENV] = lease.session;
      leaseSessionSet = true;
      restoreQueue = holdQueueStatus(opts.root, {
        plan: path.basename(planPath),
        who: `agent-kit run-plan session ${lease.session}`,
        at: new Date().toISOString(),
      });
      if (restoreQueue) {
        say(
          "Queue status: held while this run-plan runs outside the queue; restored when it ends.",
        );
      }
    }

    let stopReason: string | undefined;
    let planExhausted = false;
    let exitCode = 0;
    let endReason = "";
    // `--on-limit`: the backend may change between fresh ticks, once, when a
    // tick stops on a vendor usage limit (same plan, same tick prompt).
    let backend = opts.backend;
    let limitSwitched = false;
    // Each distinct roles warning prints once per run.
    const rolesWarned = new Set<string>();
    // The model the last tick ran on: the implementer stamp for the reviewer.
    let implementerModel: string | undefined = opts.model;
    /**
     * Reviewer scope `tick` (ADR 2026-11-16 model roles): one review-only
     * session over the unmerged branches after a completed tick. Findings (or
     * a failed review) land as a gate exit and stop the loop; a clean review
     * or nothing to review continues. The identical model is refused, never
     * a silent self-review; a setup problem warns and never fails the loop.
     */
    const reviewAfterTick = async (
      tickBackend: BackendId,
      tickModel: string | undefined,
    ): Promise<{ stop: boolean; exitCode: number }> => {
      const reviewer = opts.roles?.reviewer;
      const proceed = { stop: false, exitCode: 0 };
      if (reviewer?.scope !== "tick") return proceed;
      const warnOnce = (line: string) => {
        if (rolesWarned.has(line)) return;
        rolesWarned.add(line);
        say(`roles: ${line}`, "warn");
      };
      const relation = reviewModelRelation(tickModel, reviewer.model);
      if (relation === "identical") {
        warnOnce(
          `post-tick review skipped: ${describeIdenticalReviewModel(tickModel ?? "auto", reviewer.model ?? "auto")}`,
        );
        return proceed;
      }
      if (relation === "same-family") {
        warnOnce(describeSameFamilyReviewModel(tickModel ?? "auto", reviewer.model ?? "auto"));
      }
      // No reviewer backend set: the tick's own backend when it can run a
      // review-only session (same subscription), else PATH detection.
      const requested =
        reviewer.backend && reviewer.backend !== "auto"
          ? reviewer.backend
          : reviewer.backend !== "auto" &&
              (REVIEW_BACKENDS as readonly string[]).includes(tickBackend)
            ? tickBackend
            : "auto";
      const detected = await (opts.tickReview?.detect ?? detectAgentBackend)(requested);
      if (!detected.ok) {
        say(`roles: post-tick review not run: ${detected.message}`, "warn");
        return proceed;
      }
      say(
        `roles: reviewer ${detected.id}, model ${reviewer.model ?? "(backend default)"} (scope tick) after tick ${tick}`,
      );
      let result: RunReviewJobResult;
      try {
        result = await (opts.tickReview?.run ?? runReviewJob)({
          root: opts.root,
          backendId: detected.id,
          bin: detected.bin,
          ...(reviewer.model ? { model: reviewer.model } : {}),
          noHitl: true,
          dryRun: false,
          log: (line) => say(line),
          ...(driver ? { render: { feed: () => {}, end: () => {} } } : {}),
          // The review session is this run's live agent while it runs: the
          // lease names it and a host signal (driver mode) is forwarded to it.
          onSpawn: (info) => {
            lease?.setAgent(info.pid);
            tickAgent =
              info.pid === undefined ? null : { pid: info.pid, start: procStart(info.pid) };
          },
        });
      } catch (err) {
        tickAgent = null;
        say(`roles: post-tick review failed to run: ${String(err)}`, "warn");
        return proceed;
      }
      tickAgent = null;
      if (result.error) {
        say(`roles: post-tick review not run: ${result.error}`, "warn");
        return proceed;
      }
      if (result.outcome !== "landed") return proceed;
      return { stop: true, exitCode: result.exitCode };
    };
    // Driver protocol 1.5.0: `stop_after_tick` ends the run at the next tick
    // boundary, here (before a tick starts) and right after a tick that
    // would otherwise continue. The tick itself is never interrupted.
    const stopRequested = (): boolean => {
      if (!driver?.reader.stopRequested()) return false;
      const msg = `Stop requested by the driver (stop_after_tick) - stopping after tick ${ticksRun}. The plan is as the tick left it.`;
      say(msg);
      endReason = `${STOPPED_BY_REQUEST_REASON} after tick ${ticksRun}`;
      return true;
    };

    while (true) {
      if (stopRequested()) break;
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
      landLogPath = logPath;
      landBackend = backend.id;
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
      let tickUsage: DriverUsage | null = null;
      const endTick = (pendingAfter: number | null, sentinel: TickSentinel | null) => {
        runUsage = sumUsage(runUsage, tickUsage);
        emit({
          type: "tick_end",
          tick,
          backend: backend.id,
          limit,
          exitCode: agentExit,
          pendingBefore: before,
          pendingAfter,
          result: driverSentinel(sentinel),
          replies: driverReplies(replies),
          stop: driverStop(hitlStop),
          usage: tickUsage,
        });
      };
      try {
        // `--on-limit` fallback: a model that did not come from a flag
        // belongs to the configured backend, so it is not sent to the other one.
        const switched = backend !== opts.backend;
        const tickModel =
          switched && opts.roles && opts.roles.modelSource !== "flag" ? undefined : opts.model;
        implementerModel = tickModel;
        let tickEnv: NodeJS.ProcessEnv | undefined;
        if (opts.roles) {
          const planOverrides = readPlanRoleOverrides(await readPlan(planPath).catch(() => ""));
          const sub = resolveSubworkerModel({
            backend: backend.id,
            roles: opts.roles.roles,
            plan: planOverrides,
          });
          if (sub.warning && !rolesWarned.has(sub.warning)) {
            rolesWarned.add(sub.warning);
            say(`roles: ${sub.warning}`, "warn");
          }
          if (sub.model && backend.id === "claude") {
            tickEnv = { [CLAUDE_SUBAGENT_MODEL_ENV]: sub.model };
          }
          say(
            describeResolvedRoles({
              backendId: backend.id,
              backendSource: switched ? "flag" : opts.roles.backendSource,
              ...(tickModel ? { model: tickModel } : {}),
              ...(tickModel && opts.roles.modelSource
                ? { modelSource: opts.roles.modelSource }
                : {}),
              subworker: sub,
            }),
          );
        }
        const runOpts: Parameters<AgentBackend["run"]>[0] = {
          workspace: opts.root,
          prompt: TICK_PROMPT,
          model: tickModel,
          logPath,
          hitl: { policy: opts.noHitl ? "off" : "prompt", checkIn },
          ...(tickEnv ? { env: tickEnv } : {}),
          onSpawn: (info) => lease?.setAgent(info.pid),
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
                checkIn,
              },
              onSpawn: (info) => {
                lease?.setAgent(info.pid);
                tickAgent =
                  info.pid === undefined ? null : { pid: info.pid, start: procStart(info.pid) };
              },
            })
          : await runTickWithSpinner(`tick ${tick}`, backend, runOpts, opts.plain === true);
        // The tick's agent has exited: a signal between ticks has no one to forward to.
        tickAgent = null;
        agentExit = result.exitCode;
        tickUsage = result.usage?.total() ?? null;
        for (const line of formatHitlSummary(result.hitl)) say(line);
        hitlStop = result.hitl?.stop;
        replies = result.hitl?.replies ?? [];
        lastResult = result.lastResult;
        landSummary =
          lastResult?.resultText.trim() || lastResult?.assistantTexts.at(-1)?.trim() || undefined;
        landGateText = lastResult
          ? [lastResult.resultText, ...lastResult.assistantTexts].join("\n")
          : undefined;
      } catch (err) {
        tickAgent = null;
        say(String(err), "error");
        agentExit = 1;
        endTick(null, null);
        const reason = `tick ${tick} failed to start: ${String(err)}`;
        const pendingNow = await pending();
        landFailed = true;
        await landIfNeeded(1, reason, pendingNow);
        return finishRun(1, reason, pendingNow);
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
        landStop = hitlStop;
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
        landFailed = true;
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
        landFailed = true;
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
        landFailed = true;
        break;
      }

      const sentinel = await resolveTickSentinel(lastResult, logPath);
      const after = await pending();

      if (banners) {
        banners.tickEnd(`pending: ${after}`);
      }
      endTick(after, sentinel);

      // Reviewer scope `tick`: review the completed tick before the next one.
      const review = await reviewAfterTick(backend.id, implementerModel);
      if (review.stop) {
        const msg = `Post-tick review landed a gate exit after tick ${tick} - stopping. Read the ticket before the next tick.`;
        if (banners) banners.stop(msg);
        else say(msg);
        if (sentinel.kind === "stop") stopReason = sentinel.reason;
        if (after === 0) planExhausted = true;
        exitCode = review.exitCode;
        endReason = "review findings landed; gate exit pending";
        break;
      }

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
        landFailed = true;
        break;
      }

      if (after === 0) {
        say("All to-dos completed. Suggesting /git-prod stays with the human (HITL).");
        planExhausted = true;
        endReason = "plan exhausted";
        break;
      }

      if (stopRequested()) break;

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
      await armExternalPlanReview(opts.root, {
        ...(driver ? { log: (line) => say(line), writeOut: driver.writeErr } : {}),
        ...(implementerModel ? { implementerModel } : {}),
      });
    }

    await landIfNeeded(exitCode, endReason || "stopped", pendingNow);
    return finishRun(exitCode, endReason || "stopped", pendingNow, planExhausted);
  } finally {
    process.off("SIGINT", onSigInt);
    offTermination();
    releaseLease(false);
  }
}
