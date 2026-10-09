/**
 * `codex` tick backend (ADR 2026-10-08_codex-backend-resume-relay). Spawns
 * the user's installed, unmodified `codex` binary as `codex exec --json`
 * (vendor terms posture: unmodified binaries, no token handling).
 *
 * - **Auth.** OpenAI API key by default: `CODEX_API_KEY` (or `OPENAI_API_KEY`,
 *   passed to the child as `CODEX_API_KEY`) must be in the environment, and
 *   is injected only into the child's environment and redacted everywhere.
 *   Using the operator's own ChatGPT sign-in stays behind
 *   `AGENT_KIT_CODEX_CHATGPT_LOGIN=1`, off until OpenAI clears it for
 *   third-party apps (D5). The kit never reads codex's credential files.
 * - **Prompt.** codex has no project slash adapters, so a prompt that opens
 *   with `/<name>` gets the same thin pointer the Claude Code adapters carry
 *   (read `.cursor/commands/<name>.md`, numbered-list HITL fallback), followed
 *   by the prompt verbatim (no second tick dialect). Missing SoT file: fail
 *   closed. The prompt goes to stdin (`-`).
 * - **Stream.** The log keeps codex's raw JSONL; the renderer and the relay
 *   see a claude-style stream-json translation (`system`/`assistant`/`user`/
 *   `result`), so gate detection, `LOOP_TICK_RESULT` and driver events work
 *   unchanged.
 * - **HITL relay: resume per answer.** `codex exec` ends at every turn. A turn
 *   that ends at a gate is answered by the operator, and the stamp is sent as
 *   the prompt of `codex exec resume <thread_id>` in a new child appending to
 *   the same tick log. codex does not echo the prompt, so the log has no
 *   child-authored `HITL_REPLY` line on this backend; the run summary and
 *   `tick_end.replies` carry the stamp.
 * - **Guards.** No deny-rule flag exists for codex: `git-hooks/pre-push` is
 *   the main-push guard on this backend, and the tick prompt forbids
 *   `/git-prod`.
 */

import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  type AgentBackend,
  type BackendRunResult,
  claudeRedactions,
  mergeChildEnv,
  redactSecrets,
  resolveHitlRunOptions,
  spawnLogged,
  whichBinary,
} from "./backends.js";
import { type HitlRunRecord, emptyHitlRecord, unansweredStop } from "./hitl-relay.js";
import { vendorVersionStatus } from "./vendor-cli-pins.js";

/** Opt-in: run codex on the operator's own ChatGPT sign-in instead of an API key. */
export const CODEX_CHATGPT_LOGIN_ENV = "AGENT_KIT_CODEX_CHATGPT_LOGIN";

/** Upper bound on resumed children in one tick (one per answered gate). */
export const CODEX_MAX_RESUMES = 50;

/** Headless argv for the first turn: JSONL events, no approvals (parity with claude/cursor headless), prompt on stdin. */
export function codexExecArgs(opts: { workspace: string; model?: string }): string[] {
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--cd",
    opts.workspace,
    "--dangerously-bypass-approvals-and-sandbox",
  ];
  if (opts.model) args.push("--model", opts.model);
  args.push("-");
  return args;
}

/** Argv to continue the same codex session with the reply stamp on stdin (cwd is set on spawn). */
export function codexResumeArgs(opts: { threadId: string; model?: string }): string[] {
  const args = ["exec", "resume", "--json", "--dangerously-bypass-approvals-and-sandbox"];
  if (opts.model) args.push("--model", opts.model);
  args.push(opts.threadId, "-");
  return args;
}

export type CodexAuth =
  | { mode: "api-key"; env: NodeJS.ProcessEnv }
  | { mode: "chatgpt-login"; env: NodeJS.ProcessEnv }
  | { mode: "refused"; message: string };

/**
 * API key by default; ChatGPT sign-in only behind the opt-in flag. Reads the
 * environment only (never `~/.codex`).
 */
export function resolveCodexAuth(env: NodeJS.ProcessEnv): CodexAuth {
  if (env[CODEX_CHATGPT_LOGIN_ENV] === "1") return { mode: "chatgpt-login", env };
  const key = env.CODEX_API_KEY || env.OPENAI_API_KEY;
  if (!key) {
    return {
      mode: "refused",
      message: `codex backend: API-key mode needs OPENAI_API_KEY (or CODEX_API_KEY) in the environment. Using a ChatGPT sign-in is off by default until OpenAI clears it for third-party apps; set ${CODEX_CHATGPT_LOGIN_ENV}=1 to run on your own codex login.`,
    };
  }
  return { mode: "api-key", env: { ...env, CODEX_API_KEY: key } };
}

/** Pointer that stands in for a Claude Code command adapter (same contract, codex wording). */
export function codexSlashPointer(name: string): string {
  return [
    `Read \`.cursor/commands/${name}.md\` now and follow that contract exactly — it is the source of truth for /${name}; this paragraph is only a thin adapter for the Codex CLI.`,
    "",
    "Adapter rules (Codex CLI, headless):",
    "- Ask questions is unavailable here: print one line `HITL_GATE: <ask-id> | <label 1> | <label 2> | ...` immediately followed by the same labels as one numbered list, one list per message, then end your turn and WAIT for the answer (ask-id and labels: `.cursor/skills/core/hitl-gates/SKILL.md`). The answer arrives as your next prompt, `HITL_REPLY: <ask-id> | operator reply <n> | <label>`; cite that line as the Ask provenance.",
    "- Skip or cancel means stop.",
    "- Never `/git-prod` without an explicit operator yes.",
    "- Do not clone Cursor hooks or invent behavior beyond the SoT file.",
  ].join("\n");
}

/**
 * The prompt codex receives: pointer + the original prompt verbatim when it
 * opens with a slash whose SoT file exists; the original prompt otherwise.
 * Returns the missing SoT path when the slash has none (fail closed).
 */
export async function codexPrompt(
  workspace: string,
  prompt: string,
): Promise<{ ok: true; prompt: string } | { ok: false; missing: string }> {
  const m = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)/.exec(prompt.trimStart());
  if (!m?.[1]) return { ok: true, prompt };
  const rel = path.join(".cursor", "commands", `${m[1]}.md`);
  try {
    await access(path.join(workspace, rel));
  } catch {
    return { ok: false, missing: rel };
  }
  return { ok: true, prompt: `${codexSlashPointer(m[1])}\n\n${prompt}` };
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const line = (event: Json) => JSON.stringify(event);

/**
 * codex `exec --json` line → claude-style stream-json lines for the renderer
 * and the relay. `thread.started` reports the session id; `turn.completed`
 * becomes a `result` carrying the turn's last agent message (where the gate
 * or `LOOP_TICK_RESULT` line is); `turn.failed` an error `result`.
 */
export function createCodexTranslator(onThread: (threadId: string) => void) {
  let lastMessage = "";
  let threadId = "";
  return (raw: string): string[] => {
    const text = raw.trim();
    if (!text.startsWith("{")) return [];
    let event: unknown;
    try {
      event = JSON.parse(text);
    } catch {
      return [];
    }
    if (!isRecord(event)) return [];
    const item = isRecord(event.item) ? event.item : null;
    // Older codex builds named the field `item_type` and the message
    // `assistant_message`; accept both spellings.
    const itemType = item ? (item.type ?? item.item_type) : undefined;
    const isMessage = itemType === "agent_message" || itemType === "assistant_message";
    switch (event.type) {
      case "thread.started":
        if (typeof event.thread_id === "string") {
          threadId = event.thread_id;
          onThread(threadId);
        }
        return [line({ type: "system", subtype: "init", session_id: threadId, model: "codex" })];
      case "item.started":
        if (itemType === "command_execution" && typeof item?.command === "string") {
          return [
            line({
              type: "assistant",
              message: {
                content: [{ type: "tool_use", name: "shell", input: { command: item.command } }],
              },
            }),
          ];
        }
        return [];
      case "item.completed":
        if (isMessage && typeof item?.text === "string") {
          lastMessage = item.text;
          return [
            line({ type: "assistant", message: { content: [{ type: "text", text: item.text }] } }),
          ];
        }
        if (item && itemType === "command_execution") {
          const exit = typeof item.exit_code === "number" ? item.exit_code : null;
          return [
            line({
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    content:
                      typeof item.aggregated_output === "string" ? item.aggregated_output : "",
                    is_error: exit !== null && exit !== 0,
                  },
                ],
              },
            }),
          ];
        }
        return [];
      case "turn.completed": {
        const result = lastMessage;
        lastMessage = "";
        return [
          line({
            type: "result",
            subtype: "success",
            is_error: false,
            result,
            session_id: threadId,
            ...(isRecord(event.usage) ? { usage: event.usage } : {}),
          }),
        ];
      }
      case "turn.failed": {
        const message =
          isRecord(event.error) && typeof event.error.message === "string"
            ? event.error.message
            : "codex turn failed";
        lastMessage = "";
        return [
          line({
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            result: message,
            errors: [message],
            session_id: threadId,
          }),
        ];
      }
      default:
        return [];
    }
  };
}

const codexVersionCache = new Map<string, string | null>();

/** `codex --version`, memoized per process (null when unreadable). */
function readCodexVersion(bin: string): string | null {
  if (!codexVersionCache.has(bin)) {
    let out: string | null = null;
    try {
      out = execFileSync(bin, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      });
    } catch {
      out = null;
    }
    codexVersionCache.set(bin, out);
  }
  return codexVersionCache.get(bin) ?? null;
}

function mergeRecords(records: HitlRunRecord[]): HitlRunRecord {
  const merged = emptyHitlRecord();
  for (const r of records) {
    merged.replies.push(...r.replies);
    merged.fallbackDetections += r.fallbackDetections;
    if (r.stop) merged.stop = r.stop;
  }
  return merged;
}

export const codexBackend: AgentBackend = {
  id: "codex",
  async resolve() {
    return whichBinary("codex");
  },
  async run(opts) {
    const log = opts.log ?? ((text: string) => console.log(text));
    const auth = resolveCodexAuth(mergeChildEnv(opts.env));
    if (auth.mode === "refused") throw new Error(auth.message);
    const env = auth.env;
    const redact = claudeRedactions(env);

    const pin = vendorVersionStatus("codex", (opts.versionFn ?? readCodexVersion)("codex"));
    if (pin.status === "newer-than-tested" || pin.status === "too-old") log(pin.message);

    const prepared = await codexPrompt(opts.workspace, opts.prompt);
    if (!prepared.ok) {
      throw new Error(
        `codex backend: ${prepared.missing} is missing in the workspace, so the tick's leading slash has no contract to point codex at. Install the kit (\`agent-kit install\`) and retry.`,
      );
    }

    log(
      `codex tick: codex exec --json (no approvals, resume relay, ${auth.mode === "api-key" ? "API key" : "ChatGPT sign-in, opt-in"}).`,
    );

    let threadId: string | null = null;
    const translate = createCodexTranslator((id) => {
      threadId = id;
    });
    const hitl = resolveHitlRunOptions(opts.hitl, { kind: "resume", backend: "codex" });
    const common = {
      cwd: opts.workspace,
      env,
      redact,
      spawnFn: opts.spawnFn,
      hitl,
      render: opts.render,
      onSpawn: opts.onSpawn,
      backendId: "codex" as const,
      translate,
    };

    const records: HitlRunRecord[] = [];
    let result: BackendRunResult;
    try {
      result = await spawnLogged(
        "codex",
        codexExecArgs({ workspace: opts.workspace, model: opts.model }),
        opts.logPath,
        { ...common, stdinText: prepared.prompt },
      );
      if (result.hitl) records.push(result.hitl);
      for (let i = 0; result.resumeWith && i < CODEX_MAX_RESUMES; i += 1) {
        const reply = result.resumeWith;
        const thread: string | null = threadId;
        if (!thread) {
          const record = emptyHitlRecord();
          record.stop = {
            ...unansweredStop("none", "child exited"),
            message: "stopped: codex reported no thread id, so the reply could not be delivered",
          };
          records.push(record);
          break;
        }
        result = await spawnLogged(
          "codex",
          codexResumeArgs({ threadId: thread, model: opts.model }),
          opts.logPath,
          { ...common, stdinText: reply, appendLog: true },
        );
        if (result.hitl) records.push(result.hitl);
      }
    } catch (err) {
      // No `cause`: the raw error may carry the secret (see spawnLogged).
      throw new Error(`codex backend failed to start: ${redactSecrets(String(err), redact)}`);
    }
    return {
      exitCode: result.exitCode,
      hitl: mergeRecords(records),
      ...(result.lastResult ? { lastResult: result.lastResult } : {}),
    };
  },
};
