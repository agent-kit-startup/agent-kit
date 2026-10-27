# Driver events protocol (`agent-kit run-plan --events ndjson`, `agent-kit run-plan-all --events ndjson`)

**Version:** 1.3.0 (events carry `"v": 1`; `run_start.protocol` carries the full version). A new event type or field is a minor bump; a breaking change bumps `v`. Source: `packages/cli/src/plan-loop/driver-events.ts`; contract tests: `packages/cli/src/plan-loop/driver-events.test.ts`; decision: `.cursor/memory/decisions/2026-10-08_cli-driver-mode-ndjson-events.md`.

Driver mode lets an app, a script or a CI job drive the headless plan runner over pipes, with no terminal. It is opt-in: without `--events ndjson` the CLI behaves as before.

```bash
agent-kit run-plan --backend claude --events ndjson
```

- **stdout:** NDJSON events only, one JSON object per line.
- **stdin:** your answers, one JSON object per line.
- **stderr:** human text (the gate prompt as it would appear in a terminal, the relayed stamp, the external-review launcher output). Not part of the contract.
- **exit code:** unchanged from the terminal runner: `0` when the loop finishes (plan done, tick budget, agent stop, or a failed tick, named in `run_end.reason`), `1` on a setup failure (no active plan, backend not found, agent failed to start), `4` when a gate ended without a reply, `130` when interrupted.

The events carry the runner's existing sentinels verbatim (`TICK_PROMPT`, `HITL_GATE:`, `HITL_REPLY:`, `LOOP_TICK_RESULT:`); there is no second dialect.

## Events (stdout)

Every event has `v` (number, `1`), `ts` (ISO 8601) and `type`.

| `type` | Fields | When |
|--------|--------|------|
| `run_start` | `protocol` (`"1.3.0"`), `command` (1.2.0: `"run-plan"`), `backend`, `plan` (basename), `pending`, `maxTicks`, `hitl` (`"driver"` or `"off"` under `--no-hitl`) | Once, after the active plan is resolved |
| `tick_start` | `tick`, `maxTicks`, `pending`, `log` (tick log path, relative to the project), `prompt` (`TICK_PROMPT`, verbatim), `backend` (1.1.0) | Before each agent starts |
| `agent_event` | `tick`, `event` (one stream-json object from the agent, after secret redaction) | For every JSON line the agent prints |
| `agent_text` | `tick`, `text` | For every non-JSON line the agent prints (stderr) |
| `hitl_gate` | `tick`, `askId`, `labels` (in list order), `detection` (`"sentinel"` or `"fallback"`), `line` (the `HITL_GATE:` line) | The agent ended a turn at a gate and waits for your answer |
| `tick_end` | `tick`, `backend` (1.1.0), `limit` (1.1.0: `{source, detail}` when the backend stopped on a vendor usage limit, else `null`), `exitCode`, `pendingBefore`, `pendingAfter`, `result` (`{kind, reason?, line}` with the `LOOP_TICK_RESULT:` line, or `null`), `replies` (`[{askId, reply, label, line, at}]`), `stop` (`{askId, cause, message, exitCode}` or `null`), `usage` (1.3.0: see [Token usage](#token-usage)) | After each tick |
| `log` | `level` (`info`, `warn`, `error`), `message` | Status lines the terminal runner would print |
| `run_end` | `exitCode`, `ticks`, `pending`, `reason`, `planExhausted`, `usage` (1.3.0: the sum of the ticks' `usage`, or `null` when no tick reported any) | Last event of the run |

The agent's own echo of your answer arrives as an `agent_event` whose `event` is a `user` event with `isReplay: true` and the text `HITL_REPLY: <ask-id> | operator reply <n> | <label>`. That echo is also in the tick log, written by the agent, and is the provenance the agent cites in HANDOFF.

## Usage limits

When a tick stops on a vendor usage limit (a claude `rate_limit_event` that is not `allowed` / `allowed_warning`, an error `result` that names a limit, or a vendor stderr line that does), `tick_end.limit` says so and the run ends with `run_end.reason` `usage-limit: <backend>`; the plan is unchanged. With `--on-limit <backend>` the next fresh tick continues the same plan on that backend instead (once per run, only when it is on PATH); `tick_start.backend` shows the switch.

## Token usage

From **1.3.0**, `tick_end.usage` and `run_end.usage` carry the tokens the backend itself reported, or `null` when it reported none. The CLI adds the backend's numbers up; it never estimates them. Check `run_start.protocol` before you read the field: an older engine does not send it.

```json
{"inputTokens":579288,"cachedInputTokens":426236,"outputTokens":11131,"totalTokens":590419}
```

- `inputTokens`: every input token the models read, cached or not.
- `cachedInputTokens`: the part of `inputTokens` read from a prompt cache, or `null` when the backend does not split it out.
- `outputTokens`: output tokens, thinking included when the backend counts it there.
- `totalTokens`: `inputTokens + outputTokens`.

Where the numbers come from, per backend:

| Backend | Source | Rule |
|---------|--------|------|
| `claude`, `openrouter` | `result.modelUsage` (one entry per model, subagents included) | The session's running total: the last `result` of the tick wins. Input is `inputTokens + cacheReadInputTokens + cacheCreationInputTokens`, cached is `cacheReadInputTokens`. `result.usage` is not used when `modelUsage` is present, because it covers only the main thread's last turn. |
| `codex` | `turn.completed.usage` | The thread's running total, also after a resume (codex restores it from the session): the last report of the tick wins. `input_tokens` already includes `cached_input_tokens`. |
| `cursor-agent`, `cursor-acp` | none today | `usage` is `null`. |

A stream whose `result` carries a claude-style `usage` (`input_tokens`, `output_tokens`, optional `cache_read_input_tokens` / `cache_creation_input_tokens`) without `modelUsage` is counted turn by turn, and its turns add up. `run_end.usage` is the sum over the ticks (each tick is a new session); for `run-plan-all`, it is the one session's total. A tick that failed to start, and a run interrupted before the agent reported anything, carry `null`.

## Changelog

- **1.3.0** (additive): `tick_end.usage` and `run_end.usage` (see [Token usage](#token-usage)), on `run-plan` and `run-plan-all`.
- **1.2.0** (additive): `agent-kit run-plan-all --events ndjson` (see [Queue runner](#queue-runner-run-plan-all)); `run_start.command`; for `run-plan-all` only: `run_start.plan`, `pending` and `maxTicks` are `null`, `run_start.queue`, the `queue_state` event, `run_end.replies` and `run_end.stop`.
- **1.1.0** (additive): `tick_start.backend`, `tick_end.backend`, `tick_end.limit`; `run_end.reason` `usage-limit: <backend>`.
- **1.0.0**: first release.

## Answers (stdin)

Send exactly one line after each `hitl_gate`:

```json
{"type":"hitl_reply","askId":"queue-confirm","reply":1}
{"type":"hitl_reply","askId":"queue-confirm","reply":"Run as proposed"}
{"type":"hitl_reply","askId":"queue-confirm","reply":"only the first two plans"}
{"type":"stop"}
```

- `reply` is a 1-based number, an exact label, or free text. A number or label becomes `operator reply <n> | <label>`; anything else becomes `operator reply other | <text>`, the same as typing it in a terminal.
- `askId` must be the open gate's id. An optional `"v": 1` is accepted.
- The answer must be the operator's. Your app relays it; it never picks one on the operator's behalf.

## Stops (no default answer, ever)

Each of these ends the run with exit `4` and records the cause in `tick_end.stop` and `run_end.reason`; nothing is sent to the agent:

| Input | `stop.cause` |
|-------|--------------|
| stdin closed at a gate | `EOF` |
| `{"type":"stop"}` | `driver stop` |
| not JSON, unknown `type`, unsupported `v`, bad `reply`, or an `askId` that is not the open gate | `protocol error` |
| `--no-hitl` (no `hitl_gate` is offered) | `--no-hitl` |
| a `git-prod` / `kit-prod` gate (never relayed) | `reserved` |

## Minimal client (Node)

```js
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const run = spawn("agent-kit", ["run-plan", "--backend", "claude", "--events", "ndjson"], {
  stdio: ["pipe", "pipe", "inherit"],
});
for await (const line of createInterface({ input: run.stdout })) {
  const ev = JSON.parse(line);
  if (ev.type === "hitl_gate") {
    const reply = await askTheOperator(ev.labels); // your UI: a number or a label
    run.stdin.write(`${JSON.stringify({ type: "hitl_reply", askId: ev.askId, reply })}\n`);
  }
  if (ev.type === "run_end") console.log("done:", ev.exitCode, ev.reason);
}
```

## Queue runner (`run-plan-all`)

From protocol **1.2.0** the queue runner speaks the same protocol (an engine that announces an older `run_start.protocol` or `engine-info` `driverProtocol` has no `--events` flag on `run-plan-all`):

```bash
agent-kit run-plan-all --backend claude --events ndjson
```

`run-plan-all` is one headless agent session running the L0 `/run-plan-all` command, not a tick loop, so the event list is shorter. Answers on stdin, the stops and the exit codes are the same as for `run-plan` (exit `4` for EOF at a gate, `{"type":"stop"}`, a line that is not JSON or a reply for another `askId`).

| `type` | Fields (queue runner) | When |
|--------|-----------------------|------|
| `run_start` | `protocol`, `command` (`"run-plan-all"`), `backend`, `plan` (`null`), `pending` (`null`), `maxTicks` (`null`), `hitl`, `queue` (same fields as `queue_state`) | Once, before the agent starts |
| `queue_state` | `cursor` (0-based index into the Run queue, or `null`), `total` (plans in the Run queue), `current` (plan basename named by the cursor, or `null`), `status` (first word of the HANDOFF `Queue status` field, for example `running`, `held`, `stopped`, `exhausted`; or `null`) | Right after `run_start`, then whenever those HANDOFF fields change, and once more before `run_end` |
| `agent_event`, `agent_text` | as for `run-plan`, with `tick` always `1` | For every line the agent prints |
| `hitl_gate` | as for `run-plan`, with `tick` always `1` | The agent ended a turn at a gate, including a gate opened after a background task finished |
| `log` | as for `run-plan` | Status lines |
| `run_end` | `exitCode`, `ticks` (`1`, or `0` when no agent started), `pending` (`null`), `reason`, `planExhausted` (`false`), `replies` and `stop` (the shapes of `tick_end.replies` / `tick_end.stop`), `usage` (1.3.0: the session's tokens, see [Token usage](#token-usage)) | Last event of the run |

A queue that ends with `deferred-operator` rows ends at one more `hitl_gate`, `askId` `queue-end-gates` (`Resolve gates now` / `Print resolution prompt` / `Later`), after HANDOFF is final and `queue_state.status` already reads `exhausted (deferred: ...)`. Keep stdin open until `run_end`: closing it there ends the run with exit `4` (`EOF`), with nothing lost. `Resolve gates now` keeps the same session running (it replays the gates' Asks and re-dispatches plans whose gate opened).

To relaunch after the operator has acted on those gates, use two CLI commands that add nothing to the protocol (no event, no field, no stdin message). `agent-kit queue gates --json` prints the deferred gates from the HANDOFF `Queue outcomes` rows (plan, gate text, the Ask ids the gate names) with no agent and no model call. `agent-kit queue gates --prompt` prints the relaunch command and the resolution prompt, the same text as `Print resolution prompt`. `agent-kit run-plan-all --events ndjson --note @note.md` (or `--note "<text>"`) appends that text after the L0 command body as operator context. A note is never an answer: a note that contains a `HITL_GATE:` or `HITL_REPLY:` line is refused before any agent starts, and every gate the new session opens, `queue-confirm` included, still arrives as a `hitl_gate` and waits for your relayed reply. `run_start` does not echo the note, so keep your own copy if you want to show it. Decision: `.cursor/memory/decisions/2026-10-26_driver-chat-side-agent-programmatic-resolver.md`.

There is no `tick_start` or `tick_end`. `queue_state` is a read-only projection of the HANDOFF `Run queue`, `Queue cursor` and `Queue status` fields: the CLI never advances the cursor, the agent session does, by editing HANDOFF as the `/run-plan-all` contract says. An empty or missing queue (before the queue is confirmed) is `{"cursor":null,"total":0,"current":null,"status":null}`. The CLI polls HANDOFF about once a second and reports a change only when two consecutive polls agree, and it skips a HANDOFF that exists but is blank, so a file caught mid-rewrite (empty or half-written) never shows up as a queue change; the last read before `run_end` needs no confirmation because the session has already exited.

## Scope

`agent-kit run-plan` and, from 1.2.0, `agent-kit run-plan-all` (other `agent-kit run <slash>` dispatches have no driver mode). Backends: `claude` (stdin relay), `openrouter` (opt-in: Claude Code through Ori on OpenRouter credentials — `ori claude -- <headless argv>`, so the relay is the `claude` one; explicit-only, never selected by `auto`), `codex` (relay by resuming the codex session per answer; `agent_event` carries a claude-style translation of codex's JSONL, and the raw JSONL is in the tick log; codex does not echo the reply, so the stamp is in `tick_end.replies`), `cursor-acp` (opt-in: Cursor's `agent acp` mode; the reply is the next `session/prompt`, and a `cursor/ask_question` is offered as gate `cursor-ask-question`), `cursor-agent` (`-p`, no input channel: a gate ends the tick with `stop.cause` `no relay`). Never `/git-prod` from the headless runner.
