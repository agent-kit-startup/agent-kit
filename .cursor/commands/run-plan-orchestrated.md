---
name: run-plan-orchestrated
description: Deprecated alias for /run-plan forcing the orchestrated strategy.
---

# Command: /run-plan-orchestrated (deprecated)

**Deprecated alias.** Use **`/run-plan`**: one continuous command that picks the execution strategy itself (orchestrated is already the default when Task / subagents are available).

When invoked, follow [`run-plan.md`](run-plan.md) forcing the **orchestrated** strategy (thin main window + Task workers; no Task support → degrade per `run-plan.md`). Tell the user once:

> "Heads up: `/run-plan-orchestrated` is now `/run-plan`. Running with the orchestrated strategy."

The full tick contract, worker routing table, and worker prompt template live in `run-plan.md`. Invariants unchanged: automatic `/git-staging` on diff (including HANDOFF/memory kit buckets; never skip as trivial), **never** `/git-prod`.
