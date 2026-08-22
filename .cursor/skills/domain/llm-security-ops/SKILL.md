---
name: llm-security-ops
description: "LLM application security review (OWASP Top 10 for LLM Applications 2025) and local LLM lab ops (Docker Compose + Ollama). Project-owned domain skill; educational detect/mitigate/review only. Not contributeable upstream."
version: 0.1.0
category: domain
---

# LLM Security + Ops (domain skill)

**Project-owned domain skill** (`.cursor/skills/domain/`, one-way: never contributed to the registry; see ADR `2026-08-17_urutau-llm-lab-external-curriculum-domain-skill`). Distilled from the public [Urutau-LLM-Lab](https://github.com/thamaraprata/Urutau-LLM-Lab/) curriculum, which stays **external** — this repository does not vendor, fork, or patch the lab.

**Voice: detect, mitigate, review.** This skill contains **no** exploit payloads, CTF flags, planted prompts, or attack procedures. It teaches how to recognize and fix LLM-application weaknesses and how to run a local, isolated LLM lab.

## When to load

- Reviewing code that sends user input to an LLM (chat endpoints, agents, RAG, tool use)
- Reviewing system prompts, prompt templates, or LLM output handling
- Operating or debugging a local LLM stack (Docker Compose + Ollama, provider-switch setups)
- Security review of anything matching OWASP Top 10 for LLM Applications 2025 themes

## Binding (do not duplicate classic AppSec)

- Route review work through the **`security-reviewer` agent** (`.cursor/agents/security-reviewer.md`) and the **`cybersec` pack** discipline (`registry/packs/cybersec/`). This skill adds the LLM-specific layer only.
- Classic checks — hardcoded secrets, auth on endpoints, PII in logs, SQL/XSS injection, CORS, rate limiting — stay owned by the core `security-review` skill (`registry/skills/core/security-review/SKILL.md`) and the L0 `git-secrets-safety` rule. Do not restate them here; run both layers together on LLM-adjacent diffs.

## Review checklists — ready/wip curriculum items first

### LLM01: Prompt Injection (curriculum: ready)

Detect:
- [ ] User input concatenated into the system prompt or template without separation of roles
- [ ] Untrusted content (retrieved docs, web pages, file uploads) fed to the model as if it were instructions
- [ ] No detection of instruction-like input ("ignore previous...", role-play pivots) in high-privilege flows

Mitigate / review:
- [ ] Clear role separation (system vs user messages); never rebuild the system prompt from user data
- [ ] Treat all model input from external sources as data, not instructions; delimit and label it
- [ ] Least privilege downstream: a jailbroken response must not be able to trigger privileged actions on its own
- [ ] Output-side validation for sensitive flows (see LLM05) instead of trusting prompt-side defenses alone

### LLM07: System Prompt Leakage (curriculum: ready)

Detect:
- [ ] Secrets, credentials, internal URLs, or business rules embedded in the system prompt
- [ ] Application behavior that echoes or summarizes its own instructions on request
- [ ] Logs or error paths that include the full prompt payload

Mitigate / review:
- [ ] Assume the system prompt is ultimately extractable: keep secrets and authorization logic **out** of it (enforce server-side)
- [ ] The system prompt may state policy, but policy enforcement lives in code
- [ ] Log prompt metadata (template id, length), not full prompt bodies

### LLM06: Excessive Agency (curriculum: wip)

Detect:
- [ ] LLM-invoked tools/functions with broader permissions than the feature needs
- [ ] Irreversible or high-impact actions (writes, payments, deletes, sends) triggered by model output without human confirmation
- [ ] Agent loops with no step budget, allow-list, or scope boundary

Mitigate / review:
- [ ] Minimal tool surface: expose only the operations the use case needs, with narrow parameters
- [ ] HITL confirmation on destructive or externally visible actions
- [ ] Per-tool authorization checked server-side per call, not once per session

## Review checklists — planned curriculum items (short form)

- **LLM02 Sensitive Information Disclosure:** no PII/secrets in training data, context windows, or transcripts; scrub model I/O logs; per-user data isolation in RAG stores.
- **LLM05 Improper Output Handling:** treat model output as untrusted input — encode before rendering (XSS), parameterize before queries, validate before shell/tool execution.
- **LLM03 Supply Chain:** pin and verify model sources, weights, adapters, and container images; review third-party prompts/plugins like third-party code.
- **LLM09 Misinformation:** ground high-stakes answers (citations/RAG), communicate uncertainty, human review where wrong answers cause harm.
- **LLM10 Unbounded Consumption:** rate limits, max token/step budgets, per-user quotas, cost alarms on LLM endpoints.
- **LLM04 Data & Model Poisoning / LLM08 Vector & Embedding Weaknesses:** no lab challenge yet (curriculum gap); review against the OWASP item text directly — see the map companion.

## Companions

- [owasp-llm-map.md](owasp-llm-map.md) — OWASP LLM Top 10 (2025) to curriculum challenge map, with coverage gaps
- [local-lab-ops.md](local-lab-ops.md) — running the local lab: Docker Compose topology, Ollama model management, provider switch, hygiene
- [mitigation-patterns.md](mitigation-patterns.md) — reusable mitigation patterns referenced by the checklists

## Hard constraints

- Educational/defensive only: never author exploit payloads, working jailbreak strings, or challenge flags in this repository
- Lab use is **local and isolated**; never point testing at third-party hosted instances
- Lab chat transcripts and lab databases stay out of git
- This skill is not a registry member, not a pack member, and has no L0 command
