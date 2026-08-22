# LLM mitigation patterns

Reusable defensive patterns referenced by the `SKILL.md` checklists. Detect/mitigate/review voice only — no exploit strings, no attack walkthroughs.

## Prompt hardening (LLM01, LLM07)

- **Role separation:** system instructions and user input travel in separate message roles; never string-concatenate user data into the system prompt.
- **Data-not-instructions framing:** wrap retrieved/external content in explicit delimiters and label it as untrusted data the model must not follow as instructions.
- **Secret-free prompts:** system prompts state policy but hold no secrets, tokens, internal URLs, or authorization rules — assume eventual extraction; enforce in code.
- **Prompt as config:** version prompt templates in the repo, review them in PRs like code, and log template id/version instead of prompt bodies.

## Output handling (LLM05, and the backstop for LLM01)

- **Model output is untrusted input.** Encode for the sink: HTML-encode before rendering, parameterize before SQL, validate/allow-list before shell, tool, or URL use.
- **Schema-validate structured output** (JSON schema / function-call arguments) before acting on it; reject on validation failure rather than repairing silently.
- **Completion checks server-side:** any "success" detection (e.g. pattern matching on responses) is a game mechanic, not a security control; authorization never keys off model output.

## Bounded agency (LLM06)

- **Minimal tool surface:** expose the fewest tools with the narrowest parameter types the feature needs.
- **Server-side authorization per tool call**, evaluated per invocation against the acting user, not the model's claim.
- **HITL gates on irreversible actions:** writes, sends, payments, deletes require explicit human confirmation.
- **Budgets:** cap agent steps, tool calls, tokens, and wall time per request.

## Data protection (LLM02)

- **Context minimization:** put only the data the current user is authorized to see into the context window; per-tenant isolation in retrieval stores.
- **Transcript hygiene:** scrub or avoid logging model I/O containing PII; lab transcripts and databases stay out of git.

## Supply chain and consumption (LLM03, LLM10)

- **Pin and verify:** model tags, weights digests, container images, and third-party prompts/plugins are reviewed and pinned like code dependencies.
- **Meter everything:** rate limits and per-user quotas on LLM endpoints, token ceilings per request, cost alarms — an LLM endpoint without limits is a cost and DoS surface.

## Grounding (LLM09)

- **Cite or qualify:** ground high-stakes answers in retrieved sources; surface uncertainty; route irreversible decisions through human review.
