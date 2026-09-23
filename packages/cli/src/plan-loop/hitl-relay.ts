/**
 * Headless HITL relay (ADR 2026-09-19_headless-hitl-transport-and-live-tui.md).
 *
 * A headless run reaches a gate when the agent ends a turn with a numbered
 * list and waits for an answer. This module detects that turn end, asks the
 * operator on the terminal, and formats the reply that the backend writes to
 * the child's stdin as one `user` event. It never answers a gate by itself:
 * the only thing that produces a reply is operator keyboard input; an empty
 * line, EOF, `skip`, `cancel`, Ctrl-C, a missing TTY or `--no-hitl` stop the
 * run with an honest record and no default.
 *
 * Sentinel family (same as `LOOP_TICK_RESULT:` in sentinel.ts):
 *   HITL_GATE: <ask-id> | <label 1> | <label 2> | ... | <label n>
 *   HITL_REPLY: <ask-id> | operator reply <n> | <label>
 */

import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";

/** One line, column 0: `HITL_GATE: <kebab-id> | <label> | <label> ...`. */
export const HITL_GATE_LINE_RE = /^HITL_GATE:\s*([a-z0-9-]+)\s*\|\s*(.+)$/;

/** Reply stamp prefix; the child echoes the same event into the run log (`--replay-user-messages`). */
export const HITL_REPLY_PREFIX = "HITL_REPLY:";

/**
 * Gate ids a headless run never relays: the slash behind them is operator-gated.
 * SoT also for `RUN_PROMOTE_BLOCKED` in dispatch.ts (same ask-id / slash names).
 */
export const RESERVED_GATE_IDS = ["git-prod", "kit-prod"] as const;

/** Ask-id recorded for a gate detected from prose (pre-sentinel adapters). */
export const FALLBACK_ASK_ID = "prose-fallback";

/** Exit code of a run that ended at a gate without an operator reply. */
export const HITL_UNANSWERED_EXIT_CODE = 4;

/** Exit code when the operator interrupted the prompt with Ctrl-C. */
export const HITL_SIGINT_EXIT_CODE = 130;

const NUMBERED_LINE_RE = /^\s*(\d+)\.\s+(.+?)\s*$/;

/**
 * Prose wording that marks a numbered list as an Ask. The first two are the
 * kit's fallback-block sentences; the last two are what a real recorded gate
 * (fixture `claude-stream-run-plan-all-queue-drift.log`) actually printed.
 */
const FALLBACK_WORDING_RES = [
  /reply with (?:the |a )?number/i,
  /ask questions is not available/i,
  /skip or cancel means stop/i,
];

const TICK_SENTINEL_RE = /LOOP_TICK_RESULT:/;

export type GateDetection = "sentinel" | "fallback";

export interface HitlGate {
  askId: string;
  labels: string[];
  detection: GateDetection;
}

/** Parse one `HITL_GATE:` line; null when the line is not a sentinel or has fewer than one label. */
export function parseHitlGateLine(line: string): HitlGate | null {
  const m = HITL_GATE_LINE_RE.exec(line.trim());
  if (!m?.[1] || !m[2]) return null;
  const labels = m[2]
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (labels.length === 0) return null;
  return { askId: m[1], labels, detection: "sentinel" };
}

/** Last `HITL_GATE:` line in a text block, or null. */
export function findHitlGateInText(text: string): HitlGate | null {
  let last: HitlGate | null = null;
  for (const line of text.split(/\r?\n/)) {
    const gate = parseHitlGateLine(line);
    if (gate) last = gate;
  }
  return last;
}

/** Strip markdown emphasis and a trailing ` — explanation` from a list item. */
function cleanFallbackLabel(raw: string): string {
  let label = raw.trim();
  const bold = /^\*\*(.+?)\*\*/.exec(label);
  if (bold?.[1]) label = bold[1];
  else label = label.replace(/\*\*/g, "").replace(/^`(.+)`$/, "$1");
  label = label.split(/\s+[—–]\s+/)[0] ?? label;
  return label.replace(/[.:]+$/, "").trim();
}

/**
 * Prose fallback: a numbered list (two or more `N.` lines) plus one of the
 * known Ask sentences. Used only when no sentinel is present, for adapters
 * generated before the sentinel shipped. Labels are best effort.
 */
export function detectFallbackGate(text: string): HitlGate | null {
  if (!FALLBACK_WORDING_RES.some((re) => re.test(text))) return null;
  const labels: string[] = [];
  let expected = 1;
  for (const line of text.split(/\r?\n/)) {
    const m = NUMBERED_LINE_RE.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const n = Number(m[1]);
    if (n === 1) {
      labels.length = 0;
      expected = 1;
    }
    if (n !== expected) continue;
    labels.push(cleanFallbackLabel(m[2]));
    expected += 1;
  }
  if (labels.length < 2) return null;
  return { askId: FALLBACK_ASK_ID, labels, detection: "fallback" };
}

/**
 * Gate detection at a turn end. Order: the `result` text first, then the
 * turn's `assistant` text blocks (last block first). A result that carries a
 * `LOOP_TICK_RESULT:` line closes a tick and is never a gate.
 */
export function detectHitlGate(
  resultText: string,
  assistantTexts: readonly string[],
): HitlGate | null {
  if (TICK_SENTINEL_RE.test(resultText)) return null;
  const fromResult = findHitlGateInText(resultText);
  if (fromResult) return fromResult;
  for (let i = assistantTexts.length - 1; i >= 0; i -= 1) {
    const text = assistantTexts[i] ?? "";
    if (TICK_SENTINEL_RE.test(text)) return null;
    const gate = findHitlGateInText(text);
    if (gate) return gate;
  }
  const fallback = detectFallbackGate(resultText);
  if (fallback) return fallback;
  for (let i = assistantTexts.length - 1; i >= 0; i -= 1) {
    const gate = detectFallbackGate(assistantTexts[i] ?? "");
    if (gate) return gate;
  }
  return null;
}

export function isReservedGateId(askId: string): boolean {
  return (RESERVED_GATE_IDS as readonly string[]).includes(askId);
}

/** What the operator typed, resolved against the gate's labels. */
export type OperatorAnswer =
  | { kind: "reply"; n: number; label: string }
  | { kind: "other"; text: string }
  | { kind: "stop"; cause: "empty" | "skip" | "cancel" };

const STOP_WORDS = new Set(["skip", "cancel"]);

/**
 * A number in range or an exact label is a reply; `skip` / `cancel` that is
 * not a listed label stops; an empty line stops; anything else is `other`.
 */
export function resolveOperatorAnswer(input: string, labels: readonly string[]): OperatorAnswer {
  const text = input.trim();
  if (!text) return { kind: "stop", cause: "empty" };
  const exact = labels.indexOf(text);
  if (exact !== -1) return { kind: "reply", n: exact + 1, label: labels[exact] ?? text };
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    const label = labels[n - 1];
    if (n >= 1 && label !== undefined) return { kind: "reply", n, label };
  }
  const lower = text.toLowerCase();
  if (STOP_WORDS.has(lower)) return { kind: "stop", cause: lower as "skip" | "cancel" };
  return { kind: "other", text };
}

/** The one-line stamp written to the child (and echoed by it into the log). */
export function formatHitlReply(askId: string, answer: OperatorAnswer): string {
  if (answer.kind === "reply") {
    return `${HITL_REPLY_PREFIX} ${askId} | operator reply ${answer.n} | ${answer.label}`;
  }
  if (answer.kind === "other") {
    return `${HITL_REPLY_PREFIX} ${askId} | operator reply other | ${answer.text}`;
  }
  throw new Error("a stop answer has no reply stamp");
}

/** Raw line-reader outcome (before resolution against the labels). */
export type RawAnswer = { kind: "line"; text: string } | { kind: "eof" } | { kind: "sigint" };

export interface AnswerReadOptions {
  /** Fired when the child exits while the prompt is open; the reader must release stdin. */
  signal?: AbortSignal;
}

export type AnswerReader = (gate: HitlGate, opts: AnswerReadOptions) => Promise<RawAnswer>;

export interface TerminalAnswerReaderOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Raw-mode line editing (default: input.isTTY). */
  terminal?: boolean;
}

/**
 * Default reader: one line from the terminal through node:readline. Ctrl-C
 * in raw mode arrives as the readline SIGINT event (no process signal);
 * stream end arrives as `close` before any line (EOF). The interface is
 * closed on every path so stdin is released and raw mode restored.
 */
export function createTerminalAnswerReader(opts: TerminalAnswerReaderOptions = {}): AnswerReader {
  return (_gate, readOpts) =>
    new Promise<RawAnswer>((resolve) => {
      const input = opts.input ?? process.stdin;
      const output = opts.output ?? process.stdout;
      const terminal = opts.terminal ?? Boolean((input as NodeJS.ReadStream).isTTY);
      const rl = createInterface({ input, output, terminal });
      let settled = false;
      const finish = (answer: RawAnswer) => {
        if (settled) return;
        settled = true;
        readOpts.signal?.removeEventListener("abort", onAbort);
        rl.close();
        if (typeof (input as NodeJS.ReadStream).pause === "function") {
          (input as NodeJS.ReadStream).pause();
        }
        resolve(answer);
      };
      const onAbort = () => finish({ kind: "eof" });
      if (readOpts.signal?.aborted) {
        onAbort();
        return;
      }
      readOpts.signal?.addEventListener("abort", onAbort, { once: true });
      rl.on("SIGINT", () => finish({ kind: "sigint" }));
      rl.on("close", () => finish({ kind: "eof" }));
      rl.question("> ", (line) => finish({ kind: "line", text: line }));
    });
}

/** Stop causes recorded when a gate ends the run without a reply. */
export type HitlStopCause =
  | "empty"
  | "skip"
  | "cancel"
  | "EOF"
  | "SIGINT"
  | "no TTY"
  | "--no-hitl"
  | "no relay"
  | "reserved"
  | "child exited"
  | "quit";

export interface HitlStop {
  askId: string;
  cause: HitlStopCause;
  /** One-line record printed in the run summary. */
  message: string;
  exitCode: number;
}

export interface HitlReplyStamp {
  askId: string;
  /** `operator reply <n>` or `operator reply other`. */
  reply: string;
  label: string;
  /** The exact text written to the child. */
  line: string;
  at: string;
  detection: GateDetection;
}

/** What the run knows about its gates once the child has exited. */
export interface HitlRunRecord {
  replies: HitlReplyStamp[];
  stop?: HitlStop;
  /** Number of gates detected from prose rather than the sentinel. */
  fallbackDetections: number;
}

export function emptyHitlRecord(): HitlRunRecord {
  return { replies: [], fallbackDetections: 0 };
}

function operatorStop(
  askId: string,
  cause: "empty" | "skip" | "cancel" | "EOF" | "SIGINT",
): HitlStop {
  return {
    askId,
    cause,
    message: `stopped-by-operator: gate ${askId}, no reply (${cause})`,
    exitCode: cause === "SIGINT" ? HITL_SIGINT_EXIT_CODE : HITL_UNANSWERED_EXIT_CODE,
  };
}

/** The operator quit the live view (`q` or Ctrl-C) while no gate was open. */
export function operatorQuitStop(key: "q" | "Ctrl-C" | "SIGINT" | "SIGTERM"): HitlStop {
  return {
    askId: "none",
    cause: "quit",
    message: `stopped-by-operator: quit (${key}), no gate open`,
    exitCode: HITL_SIGINT_EXIT_CODE,
  };
}

export function unansweredStop(
  askId: string,
  cause: "no TTY" | "--no-hitl" | "child exited",
): HitlStop {
  return {
    askId,
    cause,
    message: `stopped: unanswered gate (${cause})`,
    exitCode: HITL_UNANSWERED_EXIT_CODE,
  };
}

export function noRelayStop(askId: string, backend: string): HitlStop {
  return {
    askId,
    cause: "no relay",
    message: `stopped: unanswered gate (backend ${backend} has no relay)`,
    exitCode: HITL_UNANSWERED_EXIT_CODE,
  };
}

export function reservedStop(askId: string): HitlStop {
  return {
    askId,
    cause: "reserved",
    message: `stopped: gate ${askId} is operator-gated; run the /${askId} slash yourself (never headless)`,
    exitCode: HITL_UNANSWERED_EXIT_CODE,
  };
}

/** Numbered list shown to the operator (plain text; the caller colors nothing here). */
export function formatGatePrompt(gate: HitlGate): string {
  const head =
    gate.detection === "fallback"
      ? `HITL gate (prose fallback, ask-id ${gate.askId})`
      : `HITL gate ${gate.askId}`;
  const lines = [
    "",
    `${head}: reply with the number or the label; anything else is sent as "other"; empty, skip, cancel or Ctrl-C stops the run.`,
    ...gate.labels.map((label, i) => `  ${i + 1}. ${label}`),
  ];
  return `${lines.join("\n")}\n`;
}

export interface AskOperatorOptions {
  /** Whether the process stdin is a terminal (contract: never block a non-TTY). */
  isTTY: boolean;
  /** `off` = `--no-hitl`: a gate stops the run, no read. */
  policy: "prompt" | "off";
  readAnswer: AnswerReader;
  write: (text: string) => void;
  signal?: AbortSignal;
  onPromptStart?: () => void;
  onPromptEnd?: () => void;
}

export type AskOutcome =
  | { kind: "reply"; stamp: HitlReplyStamp }
  | { kind: "stop"; stop: HitlStop };

/**
 * One gate, one decision. Prints the list, reads one line, resolves it. The
 * reply stamp is returned for the transport to deliver; a stop is returned
 * for the transport to close the child.
 */
export async function askOperator(gate: HitlGate, opts: AskOperatorOptions): Promise<AskOutcome> {
  if (isReservedGateId(gate.askId)) return { kind: "stop", stop: reservedStop(gate.askId) };
  if (opts.policy === "off") return { kind: "stop", stop: unansweredStop(gate.askId, "--no-hitl") };
  if (!opts.isTTY) return { kind: "stop", stop: unansweredStop(gate.askId, "no TTY") };

  opts.onPromptStart?.();
  let raw: RawAnswer;
  try {
    opts.write(formatGatePrompt(gate));
    raw = await opts.readAnswer(gate, { signal: opts.signal });
  } finally {
    opts.onPromptEnd?.();
  }
  if (opts.signal?.aborted) {
    return { kind: "stop", stop: unansweredStop(gate.askId, "child exited") };
  }
  if (raw.kind === "eof") return { kind: "stop", stop: operatorStop(gate.askId, "EOF") };
  if (raw.kind === "sigint") return { kind: "stop", stop: operatorStop(gate.askId, "SIGINT") };

  const answer = resolveOperatorAnswer(raw.text, gate.labels);
  if (answer.kind === "stop") return { kind: "stop", stop: operatorStop(gate.askId, answer.cause) };
  const line = formatHitlReply(gate.askId, answer);
  const stamp: HitlReplyStamp = {
    askId: gate.askId,
    reply: answer.kind === "reply" ? `operator reply ${answer.n}` : "operator reply other",
    label: answer.kind === "reply" ? answer.label : answer.text,
    line,
    at: new Date().toISOString(),
    detection: gate.detection,
  };
  return { kind: "reply", stamp };
}

/** Exit summary lines: one per reply stamp, then the stop record when present. */
export function formatHitlSummary(record: HitlRunRecord | undefined): string[] {
  if (!record) return [];
  const lines = record.replies.map(
    (s) =>
      `HITL ${s.askId}: ${s.reply} (${s.label}) ${s.at}${s.detection === "fallback" ? " [fallback]" : ""}`,
  );
  if (record.fallbackDetections > 0) {
    lines.push(`hitl-detect: prose-fallback x${record.fallbackDetections}`);
  }
  if (record.stop) lines.push(record.stop.message);
  return lines;
}

/** The run's exit code once the child has closed: a gate stop wins over the child's own code. */
export function hitlExitCode(childExitCode: number, record: HitlRunRecord | undefined): number {
  if (record?.stop) return record.stop.exitCode;
  return childExitCode;
}

/** The `user` event a stream-json child reads from stdin (one line). */
export function userEventLine(text: string): string {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
}

/**
 * Turn watcher over the tee'd NDJSON text: collects the turn's assistant
 * text blocks and fires `onResult` at every `result` event, then resets.
 * Lines that are not JSON are ignored; a partial trailing line is held.
 */
export class TurnWatcher {
  private pending = "";
  private assistantTexts: string[] = [];
  private readonly decoder = new StringDecoder("utf8");

  constructor(
    private readonly onResult: (info: {
      resultText: string;
      assistantTexts: string[];
      isError: boolean;
      subtype: string | null;
    }) => void,
  ) {}

  feed(chunk: string | Buffer): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (!text) return;
    const combined = this.pending + text;
    const lines = combined.split("\n");
    this.pending = lines.pop() ?? "";
    for (const line of lines) this.take(line);
  }

  end(): void {
    const rest = this.pending + this.decoder.end();
    this.pending = "";
    if (rest.trim()) this.take(rest);
  }

  private take(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null) return;
    const ev = event as {
      type?: unknown;
      result?: unknown;
      is_error?: unknown;
      subtype?: unknown;
      message?: { content?: unknown };
    };
    if (ev.type === "assistant") {
      const content = ev.message?.content;
      if (typeof content === "string") {
        if (content) this.assistantTexts.push(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            this.assistantTexts.push((part as { text: string }).text);
          }
        }
      }
      return;
    }
    if (ev.type === "result") {
      const texts = this.assistantTexts;
      this.assistantTexts = [];
      this.onResult({
        resultText: typeof ev.result === "string" ? ev.result : "",
        assistantTexts: texts,
        isError: ev.is_error === true,
        subtype: typeof ev.subtype === "string" ? ev.subtype : null,
      });
    }
  }
}
