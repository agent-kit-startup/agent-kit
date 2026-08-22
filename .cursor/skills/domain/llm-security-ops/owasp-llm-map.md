# OWASP LLM Top 10 (2025) — curriculum map

Source: read-only inventory of the public [Urutau-LLM-Lab](https://github.com/thamaraprata/Urutau-LLM-Lab/) (2026-08-17, HEAD `a4c6032`). The lab is an external curriculum; challenge internals (planted prompts, flags, hints, write-ups) stay in the lab and are deliberately absent here.

| OWASP item (2025) | Lab challenge | Status | Difficulty | Review entry point |
|-------------------|---------------|--------|------------|--------------------|
| LLM01: Prompt Injection | 01 — Bypass Básico | ready | ⭐ | SKILL.md LLM01 checklist |
| LLM02: Sensitive Information Disclosure | 04 — Data Exfiltration | planned | ⭐⭐ | SKILL.md short form |
| LLM03: Supply Chain | 06 — Supply Chain Attack | planned | ⭐⭐⭐ | SKILL.md short form |
| LLM04: Data & Model Poisoning | — | **no challenge (gap)** | — | OWASP item text directly |
| LLM05: Improper Output Handling | 05 — Output Injection | planned | ⭐⭐⭐ | SKILL.md short form |
| LLM06: Excessive Agency | 03 — Agente Rebelde | in construction | ⭐⭐ | SKILL.md LLM06 checklist |
| LLM07: System Prompt Leakage | 02 — Vazamento de System Prompt | ready | ⭐ | SKILL.md LLM07 checklist |
| LLM08: Vector & Embedding Weaknesses | — | **no challenge (gap)** | — | OWASP item text directly |
| LLM09: Misinformation | 07 — Misinformation | planned | ⭐⭐ | SKILL.md short form |
| LLM10: Unbounded Consumption | 08 — Unbounded Consumption | planned | ⭐ | SKILL.md short form |

Challenge 00 ("Chat Livre") is a free-chat baseline with no OWASP mapping.

## Reading the map

- **ready** challenges (01, 02) are exercisable today in the local lab; their checklists in `SKILL.md` are full detect/mitigate/review sets.
- **in construction / planned** rows track the upstream roadmap; review guidance does not wait for the lab — the short-form checklists apply now.
- **Gap rows (LLM04, LLM08):** the curriculum does not yet cover data/model poisoning or vector/embedding weaknesses. Do not report "covered by lab" for these; review against the [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) item text.

## What we learn vs what stays external

- **Learned here:** the mapping above, detect/mitigate/review checklists, local-lab ops patterns.
- **Stays in the lab:** flag values and patterns, planted vulnerable system prompts, hints, write-ups, exploit walkthroughs, and any chat transcripts produced while exercising challenges.
