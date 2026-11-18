# Model roles: per-backend capability matrix

What each agent backend lets the kit control for the three model roles (worker, subworker, reviewer). The `roles` config key (ADR `2026-11-16_model-roles-config-contract.md`) and the Mission Control Config tab read this table: a value the matrix marks **unsupported** is rejected or ignored with a warning, never guessed.

Verified 2026-11-16 against the installed CLIs (`claude` 2.1.325, `cursor-agent` 2026.11.13-eacade1, `codex` 0.169.0, `ori` 0.17.0) and the vendor docs linked below. Rows marked *unverified* came from a vendor doc summary that could not be checked against a local binary or verbatim text; the kit does not wire them.

## Summary

| Backend (`--backend`) | Worker model (`roles.worker.model`) | Subworker model (`roles.subworker`) | Model list for a picker | Reviewer on the same subscription |
|---|---|---|---|---|
| `claude` | Supported: `claude -p --model <alias or full id>` | Supported: `CLAUDE_CODE_SUBAGENT_MODEL` in the tick env | No listing command; static aliases plus free text | Supported (review job and audits launcher) |
| `cursor-agent` | Supported: `cursor-agent -p --model <id>` | Unsupported as a separate role: subagents use `model: inherit` (the worker model) | `cursor-agent models` / `--list-models` | Supported (review job and audits launcher; Claude-family names collapse to `auto` on the launcher) |
| `codex` (explicit-only) | Supported: `codex exec --model <id>` | Unsupported in the kit (vendor key documented, not wired; warns) | `codex debug models` (JSON catalog) | Unsupported (no review path on codex) |
| `openrouter` (explicit-only, `ori claude`) | Supported: Ori `--model <openrouter id>` before `--` | Unsupported (warns): Claude Code's variable would need an OpenRouter-mapped id | No listing command in `ori --help`; free text | Unsupported (no review path on Ori) |
| `cursor-acp` (explicit-only) | Unsupported: the model is not sent over ACP (warns) | Unsupported (warns) | Not applicable | Unsupported (no review path on ACP) |

Paid backends (`codex`, `cursor-acp`, `openrouter`) stay explicit-only: naming one in `roles.worker.backend` is an explicit choice, and a missing binary fails the run instead of falling back to another billed backend (`packages/cli/src/plan-loop/detect.ts:16-19`).

## Evidence per backend

### claude

- **Worker model.** `claudeHeadlessArgs` appends `--model` (`packages/cli/src/plan-loop/backends.ts:1050-1052`). `claude --help` (2.1.325): "`--model <model>` Model for the current session. Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name." Current full ids: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`.
- **Subworker model.** `CLAUDE_CODE_SUBAGENT_MODEL` sets "the default model for subagents ... that aren't assigned a model another way" (https://code.claude.com/docs/en/model-config). Precedence (https://code.claude.com/docs/en/sub-agents, "Choose a model"): per-invocation `model` parameter, then the subagent definition's `model` field (including `inherit`), then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's model. The variable string is present in the 2.1.325 binary. Limits the kit records and does not work around:
  - a subagent definition with its own `model:` wins over the variable (the kit generates no `.claude/agents/`, so kit subagents have none);
  - the built-in Explore and Plan agents do not change model on the variable alone;
  - `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` would override definitions too; the kit never sets it.
  Frontmatter `model:` accepts `sonnet`, `opus`, `haiku`, `fable`, a full id such as `claude-opus-5-5`, or `inherit` (same page, frontmatter reference).
- **Model list.** No listing command in `claude --help` or the model-config page; the only listing path documented is gateway discovery (`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`), which the kit does not use. Picker source: the aliases `opus`, `sonnet`, `haiku`, `fable` plus free text.
- **Reviewer.** Review job: `claudeReviewArgs` passes `--model` (`backends.ts:1087`), `REVIEW_BACKENDS` = claude, cursor-agent (`packages/cli/src/plan-loop/review-job.ts:64`). Audits launcher: `claude --model "${WAIT_REVIEWER_MODEL:-sonnet}"` (`.cursor/scripts/plan-external-review.sh:1739-1741`), advisor `--model "${ADVISOR_MODEL:-opus}"` (`:1806`). One subscription can run both worker and reviewer; today the launcher refuses a same-family pair (`plan-external-review.sh:1547-1549,1610-1612`), which is the subject of the reviewer-role family-rule Ask.

### cursor-agent

- **Worker model.** `cursorAgentHeadlessArgs` appends `--model` (`backends.ts:861`). `cursor-agent --help` (2026.11.13-eacade1): "`--model <model>` Model to use (e.g., gpt-5, sonnet-4-thinking). Parameterized models accept quoted bracket overrides". Docs: https://cursor.com/docs/cli/reference/parameters.
- **Subworker model.** Cursor subagents read the `model` frontmatter of `.cursor/agents/*.md`: "`inherit` or a specific model ID", default `inherit` = "Uses the same model as the parent agent" (https://cursor.com/docs/agent/subagents). The kit ships `model: inherit`, so Cursor subagents follow the worker model. A separate subworker model would mean rewriting managed L0 files per workspace, so the role is unsupported on this backend and warns once.
- **Model list.** `cursor-agent --list-models` and `cursor-agent models` ("List available models for this account"), in local help and the parameters page.
- **Reviewer.** `cursorAgentReviewArgs` passes `--model` (`backends.ts:890`); the launcher runs `cursor-agent -p ... --model "$WAIT_REVIEWER_MODEL"` (`plan-external-review.sh:1734`) and collapses a Claude-family reviewer name to `auto` (`effective_reviewer_model`, `:1552-1586`).

### codex (explicit-only)

- **Worker model.** `codexExecArgs` / `codexResumeArgs` append `--model` (`packages/cli/src/plan-loop/codex.ts:66,74`). `codex exec --help` (0.169.0): "`-m, --model <MODEL>` Model the agent should use".
- **Subworker model.** *Unverified for wiring:* the Codex config reference documents `agents.default_subagent_model` ("Default model for spawned agents. An explicit spawn model takes precedence"), and the key string is present in the 0.169.0 binary, but the source page was only available as a summary (https://learn.chatgpt.com/docs/config-file/config-reference, moved from developers.openai.com). The kit does not pass it; `roles.subworker` on codex warns once.
- **Model list.** `codex debug models` ("Render the raw model catalog as JSON", local `codex debug --help`).
- **Reviewer.** No review path: the review job accepts claude or cursor-agent only (`review-job.ts:64`), the launcher accepts `auto|claude|cursor`.

### openrouter (explicit-only, `ori claude`)

- **Worker model.** `openrouterArgs` puts Ori's `--model` before `--` (`backends.ts:1275-1278`). `ori claude --help` (0.17.0): "`--model <string>` OpenRouter model ID, such as `anthropic/claude-sonnet-4.6`; the launcher translates it to the upstream model setting". No fallback to plain `claude` (`detect.ts` install hint, ADR 2026-09-19 Amend 2026-10-21).
- **Subworker model.** Unsupported: Ori seeds Claude Code's model catalog and translates only its own `--model`; whether `CLAUDE_CODE_SUBAGENT_MODEL` with an OpenRouter id is honored is not documented. The kit does not set it on this backend and warns once.
- **Model list.** No models command in `ori --help`; free text.
- **Reviewer.** No review path.

### cursor-acp (explicit-only)

- **Worker model.** Unsupported: `runCursorAcp` prints "--model is not sent over ACP; the agent's default model runs." (`packages/cli/src/plan-loop/cursor-acp.ts:147`). The ACP page documents no model selection over ACP (https://cursor.com/docs/cli/acp).
- **Subworker model.** Unsupported.
- **Model list.** Not applicable.
- **Reviewer.** No review path.

## How the kit uses this table

- `packages/cli/src/plan-loop/model-roles.ts` holds the same table as data (`ROLE_CAPABILITIES`), and `dashboard/lib/guards.mjs` mirrors it for the Config tab; a parity test keeps them equal.
- Unsupported worker model: rejected by the Config tab, warned and dropped by the CLI.
- Unsupported subworker model: rejected by the Config tab when the worker backend is pinned, otherwise warned once per run by the CLI.
- Re-verify the table when a vendor CLI pin moves (`packages/cli/src/plan-loop/vendor-cli-pins.ts`).
