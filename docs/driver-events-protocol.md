# Driver events protocol (`agent-kit run-plan --events ndjson`)

**Version:** 1.1.0 (events carry `"v": 1`; `run_start.protocol` carries the full version). A new event type or field is a minor bump; a breaking change bumps `v`. Source: `packages/cli/src/plan-loop/driver-events.ts`; contract tests: `packages/cli/src/plan-loop/driver-events.test.ts`; decision: `.cursor/memory/decisions/2026-10-08_cli-driver-mode-ndjson-events.md`.

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
| `run_start` | `protocol` (`"1.1.0"`), `backend`, `plan` (basename), `pending`, `maxTicks`, `hitl` (`"driver"` or `"off"` under `--no-hitl`) | Once, after the active plan is resolved |
| `tick_start` | `tick`, `maxTicks`, `pending`, `log` (tick log path, relative to the project), `prompt` (`TICK_PROMPT`, verbatim), `backend` (1.1.0) | Before each agent starts |
| `agent_event` | `tick`, `event` (one stream-json object from the agent, after secret redaction) | For every JSON line the agent prints |
| `agent_text` | `tick`, `text` | For every non-JSON line the agent prints (stderr) |
| `hitl_gate` | `tick`, `askId`, `labels` (in list order), `detection` (`"sentinel"` or `"fallback"`), `line` (the `HITL_GATE:` line) | The agent ended a turn at a gate and waits for your answer |
| `tick_end` | `tick`, `backend` (1.1.0), `limit` (1.1.0: `{source, detail}` when the backend stopped on a vendor usage limit, else `null`), `exitCode`, `pendingBefore`, `pendingAfter`, `result` (`{kind, reason?, line}` with the `LOOP_TICK_RESULT:` line, or `null`), `replies` (`[{askId, reply, label, line, at}]`), `stop` (`{askId, cause, message, exitCode}` or `null`) | After each tick |
| `log` | `level` (`info`, `warn`, `error`), `message` | Status lines the terminal runner would print |
| `run_end` | `exitCode`, `ticks`, `pending`, `reason`, `planExhausted` | Last event of the run |

The agent's own echo of your answer arrives as an `agent_event` whose `event` is a `user` event with `isReplay: true` and the text `HITL_REPLY: <ask-id> | operator reply <n> | <label>`. That echo is also in the tick log, written by the agent, and is the provenance the agent cites in HANDOFF.

## Usage limits

When a tick stops on a vendor usage limit (a claude `rate_limit_event` that is not `allowed` / `allowed_warning`, an error `result` that names a limit, or a vendor stderr line that does), `tick_end.limit` says so and the run ends with `run_end.reason` `usage-limit: <backend>`; the plan is unchanged. With `--on-limit <backend>` the next fresh tick continues the same plan on that backend instead (once per run, only when it is on PATH); `tick_start.backend` shows the switch.

## Changelog

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

## Scope

`agent-kit run-plan` only. Backends: `claude` (stdin relay), `codex` (relay by resuming the codex session per answer; `agent_event` carries a claude-style translation of codex's JSONL, and the raw JSONL is in the tick log; codex does not echo the reply, so the stamp is in `tick_end.replies`), `cursor-acp` (opt-in: Cursor's `agent acp` mode; the reply is the next `session/prompt`, and a `cursor/ask_question` is offered as gate `cursor-ask-question`), `cursor-agent` (`-p`, no input channel: a gate ends the tick with `stop.cause` `no relay`). Never `/git-prod` from the headless runner.
