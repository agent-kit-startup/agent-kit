---
name: run-plan-loop
description: Deprecated alias for /run-plan forcing the in-session loop strategy.
---

# Command: /run-plan-loop (deprecated)

**Deprecated alias.** Use **`/run-plan`**: one continuous command that picks the execution strategy itself.

When invoked, follow [`run-plan.md`](run-plan.md) forcing the **in-session loop** strategy (the session agent implements each tick itself; the window grows). Tell the user once:

> "Heads up: `/run-plan-loop` is now `/run-plan`. Running with the in-session strategy."

The full tick contract (plan status per tick, HANDOFF, automatic `/git-staging` on diff including HANDOFF/memory kit buckets, **never** skip those as trivial, **never** `/git-prod`, stop conditions) lives in `run-plan.md`, including the headless runner (`scripts/plan-loop.sh`) section.
