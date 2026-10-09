/**
 * `cursor-acp` tick backend: Cursor's documented `agent acp` stdio mode
 * (https://cursor.com/docs/cli/acp) driven by a small JSON-RPC 2.0 client on
 * Node built-ins, so Cursor gates are answered instead of ending the tick
 * ("no relay" on `cursor-agent -p`). Opt-in (`--backend cursor-acp`); the
 * `cursor-agent` backend is unchanged. ADR 2026-09-19 point 1 Amend
 * (2026-10-08). This is an ACP *client*; the kit runs no ACP server
 * (ADR 2026-08-22).
 *
 * Session: `initialize` → `authenticate` (`cursor_login`, only when advertised)
 * → `session/new {cwd, mcpServers: []}` → `session/prompt` per turn.
 * - `session/update` `agent_message_chunk` text is collected per turn; at the
 *   turn end the text goes to the renderer / driver as one claude-style
 *   `assistant` event plus a `result`, so gate detection, `LOOP_TICK_RESULT`
 *   and the loop are shared with the other backends.
 * - A turn that ends at a `HITL_GATE` (or the prose fallback) is answered by
 *   the operator exactly as on claude (terminal or driver mode, never a
 *   default); the stamp is the next `session/prompt` in the same session.
 * - `cursor/ask_question` is relayed as gate `cursor-ask-question` with the
 *   question's option labels; a free-text or stop answer is sent back as
 *   `cancelled`.
 * - `session/request_permission` is answered `allow-once`: parity with the
 *   `cursor-agent -p --force` headless backend (no prompt reaches anyone
 *   there either).
 * - `cursor/create_plan`, `fs/*`, `terminal/*` and unknown requests get
 *   JSON-RPC `-32601` (the client advertises no fs/terminal capability; the
 *   create_plan rejection shape is undocumented).
 * The tick log holds every JSON-RPC line in both directions after redaction
 * (the client's `session/prompt` carrying a `HITL_REPLY` stamp is the message
 * the agent received, as stdin is for claude). Vendor sign-in stays in
 * `cursor-agent login`; the kit never reads Cursor credentials.
 */

import type { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import {
  type AgentBackend,
  type BackendRunOptions,
  type BackendRunResult,
  RedactingStreamBuffer,
  claudeRedactions,
  mergeChildEnv,
  redactSecrets,
  resolveHitlRunOptions,
  whichBinary,
} from "./backends.js";
import {
  type HitlGate,
  type HitlRunRecord,
  type TurnResult,
  askOperator,
  detectHitlGate,
  emptyHitlRecord,
} from "./hitl-relay.js";
import { LineSplitter } from "./line-splitter.js";
import { createStreamRenderer } from "./stream-render.js";

/** ACP protocol major the client speaks (Cursor 2026.10.01 answers 1). */
export const ACP_PROTOCOL_VERSION = 1;
/** Gate id for a relayed `cursor/ask_question`. */
export const CURSOR_ASK_QUESTION_ID = "cursor-ask-question";
/** ms after stdin end before SIGTERM (the agent does not exit on stdin end, measured), then SIGKILL. */
const ACP_EXIT_GRACE_MS = 1000;
const ACP_KILL_GRACE_MS = 5000;
/** Upper bound on relayed turns in one tick. */
export const ACP_MAX_TURNS = 50;

/** Argv: the documented ACP mode, nothing else (flags are not part of the ACP contract). */
export function cursorAcpArgs(): string[] {
  return ["acp"];
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `initialize` params: no fs / terminal capability, so the agent keeps file and shell work to itself. */
export function acpInitializeParams(): Json {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "agent-kit", version: "1" },
  };
}

/** Permission answer: `allow-once` when offered (by id or kind), else cancelled. */
export function acpPermissionOutcome(params: unknown): Json {
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : [];
  const pick =
    options.find((o) => isRecord(o) && (o.optionId === "allow-once" || o.kind === "allow_once")) ??
    options.find(
      (o) =>
        isRecord(o) &&
        ((typeof o.optionId === "string" && o.optionId.startsWith("allow")) ||
          (typeof o.kind === "string" && o.kind.startsWith("allow"))),
    );
  if (isRecord(pick) && typeof pick.optionId === "string") {
    return { outcome: { outcome: "selected", optionId: pick.optionId } };
  }
  return { outcome: { outcome: "cancelled" } };
}

interface AskQuestion {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
}

/** Questions of a `cursor/ask_question` request that carry at least one option. */
export function acpQuestions(params: unknown): AskQuestion[] {
  const raw = isRecord(params) && Array.isArray(params.questions) ? params.questions : [];
  const out: AskQuestion[] = [];
  for (const q of raw) {
    if (!isRecord(q) || typeof q.id !== "string" || !Array.isArray(q.options)) continue;
    const options = q.options
      .filter((o): o is Json => isRecord(o) && typeof o.id === "string")
      .map((o) => ({
        id: o.id as string,
        label: String(typeof o.label === "string" ? o.label : o.id)
          .replace(/\|/g, "/")
          .trim(),
      }));
    if (options.length === 0) continue;
    out.push({ id: q.id, prompt: typeof q.prompt === "string" ? q.prompt : "", options });
  }
  return out;
}

const line = (event: Json) => `${JSON.stringify(event)}\n`;

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: { message: string; code?: number }) => void;
}

export async function runCursorAcp(opts: BackendRunOptions): Promise<BackendRunResult> {
  const say = opts.log ?? ((text: string) => console.log(text));
  const env = mergeChildEnv(opts.env);
  const redact = claudeRedactions(env);
  const hitl = resolveHitlRunOptions(opts.hitl, { kind: "none", backend: "cursor-acp" });
  const render = opts.render ?? createStreamRenderer();
  const spawnFn = opts.spawnFn ?? ((await import("node:child_process")).spawn as typeof spawn);
  const record: HitlRunRecord = emptyHitlRecord();
  const abort = new AbortController();

  if (opts.model) say("cursor-acp: --model is not sent over ACP; the agent's default model runs.");
  say("cursor tick: cursor-agent acp (JSON-RPC stdio, HITL relay, tool permissions allow-once).");

  const out = createWriteStream(opts.logPath, { flags: "w" });
  let logError: unknown = null;
  out.on("error", (err) => {
    logError = err;
  });
  const logLine = (text: string) => out.write(`${redactSecrets(text, redact)}\n`);

  const child = spawnFn("cursor-agent", cursorAcpArgs(), {
    cwd: opts.workspace,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map<number, Pending>();
  let closed = false;
  let exitCode: number | null = null;
  let spawnError: Error | null = null;
  let resolveClosed: () => void = () => {};
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const gone = (code: number | null) => {
    if (closed) return;
    closed = true;
    exitCode = code;
    abort.abort();
    for (const p of pending.values()) {
      p.reject({ message: `cursor-agent acp exited (code ${code ?? "signal"})` });
    }
    pending.clear();
    resolveClosed();
  };
  child.on("close", (code) => gone(code));
  // The raw spawn error is not kept as `cause`: its message may carry a secret.
  child.on("error", (err) => {
    spawnError = new Error(redactSecrets(String(err), redact));
    gone(null);
  });

  let nextId = 1;
  let turnText = "";
  let sessionId: string | null = null;

  const send = (msg: Json) => {
    const text = JSON.stringify(msg);
    logLine(text);
    try {
      child.stdin?.write(`${text}\n`);
    } catch {
      // Child gone; the close handler rejects what is pending.
    }
  };
  const request = (method: string, params: Json) =>
    new Promise<unknown>((resolve, reject) => {
      if (closed) {
        reject({ message: "cursor-agent acp is not running" });
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
    });
  const respond = (id: unknown, result: Json) => send({ jsonrpc: "2.0", id, result });
  const respondError = (id: unknown, code: number, message: string) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });

  const ask = (gate: HitlGate) =>
    askOperator(gate, {
      isTTY: hitl.isTTY,
      policy: hitl.policy,
      readAnswer: hitl.readAnswer,
      write: hitl.write,
      signal: abort.signal,
      onPromptStart: hitl.onPromptStart,
      onPromptEnd: hitl.onPromptEnd,
    });

  const cancelSession = () => {
    if (sessionId && !closed)
      send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  };

  const handleAskQuestion = async (id: unknown, params: unknown) => {
    const answers: Json[] = [];
    for (const q of acpQuestions(params)) {
      if (record.stop) break;
      const gate: HitlGate = {
        askId: CURSOR_ASK_QUESTION_ID,
        labels: q.options.map((o) => o.label),
        detection: "sentinel",
      };
      const outcome = await ask(gate);
      if (outcome.kind === "stop") {
        record.stop = outcome.stop;
        break;
      }
      record.replies.push(outcome.stamp);
      hitl.write(`→ ${outcome.stamp.line}\n`);
      const n = /operator reply (\d+)/.exec(outcome.stamp.reply)?.[1];
      const option = n ? q.options[Number(n) - 1] : undefined;
      if (!option) {
        hitl.write(
          "cursor-acp: a free-text answer has no cursor/ask_question option; the question is answered as cancelled.\n",
        );
        respond(id, { outcome: { outcome: "cancelled" } });
        return;
      }
      answers.push({ questionId: q.id, selectedOptionIds: [option.id] });
    }
    if (record.stop) {
      respond(id, { outcome: { outcome: "cancelled" } });
      cancelSession();
      return;
    }
    respond(id, { outcome: { outcome: "answered", answers } });
  };

  const handleRequest = (msg: Json) => {
    const { id, method, params } = msg;
    if (method === "session/request_permission") {
      respond(id, acpPermissionOutcome(params));
      return;
    }
    if (method === "cursor/ask_question") {
      void handleAskQuestion(id, params);
      return;
    }
    respondError(id, -32601, `agent-kit does not implement ${String(method)}`);
  };

  const handleNotification = (msg: Json) => {
    if (msg.method !== "session/update" || !isRecord(msg.params)) return;
    const update = isRecord(msg.params.update) ? msg.params.update : null;
    if (!update) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = isRecord(update.content) ? update.content : null;
      if (content?.type === "text" && typeof content.text === "string") turnText += content.text;
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      const title = typeof update.title === "string" ? update.title : "tool";
      render.feed(
        line({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: typeof update.kind === "string" ? update.kind : "tool",
                input: { title },
              },
            ],
          },
        }),
      );
    }
  };

  const take = (raw: string) => {
    const text = redactSecrets(raw.replace(/\r$/, ""), redact);
    if (!text.trim()) return;
    out.write(`${text}\n`);
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(msg)) return;
    if (typeof msg.method === "string") {
      if (msg.id !== undefined && msg.id !== null) handleRequest(msg);
      else handleNotification(msg);
      return;
    }
    if (typeof msg.id === "number") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (isRecord(msg.error)) {
        p.reject({
          message: typeof msg.error.message === "string" ? msg.error.message : "JSON-RPC error",
          ...(typeof msg.error.code === "number" ? { code: msg.error.code } : {}),
        });
      } else p.resolve(msg.result);
    }
  };

  const decoder = new StringDecoder("utf8");
  const splitter = new LineSplitter();
  child.stdout?.on("data", (chunk: Buffer | string) => {
    splitter.feed(typeof chunk === "string" ? chunk : decoder.write(chunk), take);
  });
  const errBuffer = new RedactingStreamBuffer(redact);
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = redact.length ? errBuffer.push(chunk) : String(chunk);
    if (text) out.write(text);
  });
  child.stdin?.on("error", () => {});

  let stopped = false;
  const endChild = () => {
    if (stopped) return;
    stopped = true;
    try {
      child.stdin?.end();
    } catch {
      // already closed
    }
    const term = setTimeout(() => {
      if (closed) return;
      child.kill("SIGTERM");
      const kill = setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, ACP_KILL_GRACE_MS);
      kill.unref?.();
    }, ACP_EXIT_GRACE_MS);
    term.unref?.();
  };

  opts.onSpawn?.({
    backend: "cursor-acp",
    pid: child.pid,
    stop: (stop) => {
      if (closed || record.stop) return;
      record.stop = stop;
      cancelSession();
      abort.abort();
      endChild();
    },
  });

  let lastResult: TurnResult | undefined;
  const finishTurn = (text: string, isError: boolean, subtype: string, errors: string[]) => {
    render.feed(line({ type: "assistant", message: { content: [{ type: "text", text }] } }));
    render.feed(
      line({
        type: "result",
        subtype,
        is_error: isError,
        result: text,
        session_id: sessionId ?? "",
        ...(errors.length ? { errors } : {}),
      }),
    );
    lastResult = { resultText: text, assistantTexts: text ? [text] : [], isError, subtype, errors };
  };
  const failed = (message: string, subtype = "error") =>
    finishTurn(message, true, subtype, [message]);

  const session = async () => {
    const init = await request("initialize", acpInitializeParams());
    const methods = isRecord(init) && Array.isArray(init.authMethods) ? init.authMethods : [];
    if (methods.some((m) => isRecord(m) && m.id === "cursor_login")) {
      try {
        await request("authenticate", { methodId: "cursor_login" });
      } catch (err) {
        const message = (err as { message?: string }).message ?? String(err);
        throw {
          message: `Cursor sign-in needed: run \`cursor-agent login\` in a terminal (the kit never handles Cursor credentials). ${message}`,
        };
      }
    }
    const created = await request("session/new", { cwd: opts.workspace, mcpServers: [] });
    if (!isRecord(created) || typeof created.sessionId !== "string") {
      throw { message: "cursor-agent acp returned no sessionId" };
    }
    sessionId = created.sessionId;
    render.feed(
      line({ type: "system", subtype: "init", session_id: sessionId, model: "cursor-acp" }),
    );

    let prompt = opts.prompt;
    for (let turn = 0; turn < ACP_MAX_TURNS && !record.stop; turn += 1) {
      turnText = "";
      let stopReason = "end_turn";
      try {
        const res = await request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: prompt }],
        });
        if (isRecord(res) && typeof res.stopReason === "string") stopReason = res.stopReason;
      } catch (err) {
        failed((err as { message?: string }).message ?? String(err));
        return;
      }
      const text = turnText;
      finishTurn(text, stopReason === "refusal", stopReason, []);
      if (record.stop || stopReason === "cancelled") return;
      const gate = detectHitlGate(text, []);
      if (!gate) return;
      if (gate.detection === "fallback") record.fallbackDetections += 1;
      const outcome = await ask(gate);
      if (outcome.kind === "stop") {
        record.stop = outcome.stop;
        return;
      }
      record.replies.push(outcome.stamp);
      hitl.write(`→ ${outcome.stamp.line}\n`);
      prompt = outcome.stamp.line;
    }
  };

  await session().catch((err: unknown) => {
    failed((err as { message?: string }).message ?? String(err));
  });
  const failure = spawnError as Error | null;
  if (failure) {
    out.end();
    throw new Error(`cursor-acp backend failed to start: ${failure.message}`);
  }
  const endedByClient = !closed;
  endChild();
  await closedPromise;
  const rest = splitter.end();
  if (rest.trim()) take(rest);
  const errRest = errBuffer.flush();
  if (errRest) out.write(errRest);
  render.end();
  await new Promise<void>((resolve) => out.end(() => resolve()));
  if (logError) throw new Error(`cursor-acp backend: ${redactSecrets(String(logError), redact)}`);

  const code = lastResult?.isError ? 1 : endedByClient ? 0 : (exitCode ?? 1);
  return { exitCode: code, hitl: record, ...(lastResult ? { lastResult } : {}) };
}

/**
 * Opt-in Cursor backend over `agent acp` (the installed `cursor-agent`
 * binary, unmodified). `cursor-agent` (`-p`, no relay) stays the default.
 */
export const cursorAcpBackend: AgentBackend = {
  id: "cursor-acp",
  async resolve() {
    return whichBinary("cursor-agent");
  },
  run: runCursorAcp,
};
