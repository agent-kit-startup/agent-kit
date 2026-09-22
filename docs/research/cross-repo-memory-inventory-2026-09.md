# Cross-repo memory inventory (2026-09)

Research note for plan `cross-repo-memory-inventory-consolidate.plan.md` Phase 0. Check is not apply. This file does not rewrite adjacent docs, `.cursor/memory/_index.md`, or `CHANGELOG.md`. It does not add a fleet memory product.

**Scanned:** 2026-09-21. Checkout: private factory, branch `staging`, HEAD `e0829818`. Commands: `git branch -a`, `gh pr list --state open`, `gh pr list --state merged --limit 20`, `git log --oneline -40`, theme `git log --grep` (orchestration, cross-repo, memory, fleet, AgentStore, dogfood, orquestracao), plus named reads listed below.

**Scope:** this checkout only. Sibling repositories were not opened and are not written here.

## Git snapshot

| Surface | Evidence this scan |
|---------|--------------------|
| Current branch | `staging` (tracks `origin/staging`) |
| Working tree | Clean (`git status -sb` shows no dirty paths) |
| Open PRs | None (re-verified; Broad Intake 2026-09-20 also recorded none) |
| Theme merge already on staging | PR **#886** merged 2026-09-11: `docs(dogfood): orquestração entre repositórios e a superfície humana` (`312d9b68`) |
| Leftover remote after #886 | `origin/docs/dogfood-orquestracao-entre-repos` still exists (`d15b294c`). Not deleted this tick |
| Recent merged PRs (sample) | #939 landing zip 7 v2, #938/#937 landing hero+video, #936 contract-read closeout, #921 hosted-harness paper. None is an in-flight cross-repo memory PR |
| Local extra branch | `docs/run-plan-all-resume-ask` (also on origin). Not this residual |

Other origin remotes still present after merged work (`docs/adr-major-tom-unship-local-infra`, `docs/product-context-reasoning-monetization-model`, `feat/major-tom-claude-backend`, `update/landing-zip7-v2-sync`, plus two unrelated `claude/` / patch refs) are **out of this plan**. Phase 2 names only the #886 leftover unless a later HITL widens hygiene.

## Inventory table

| Artifact | Kind | Status | Owner or none |
|----------|------|--------|----------------|
| `.cursor/memory/decisions/2026-09-15_orchestration-stays-per-repository.md` | ADR | Accepted. Kit stays per-repository. Fleet boards out of L0. Cross-repo blockers are operator-carried. Indexed in `_index.md` | none (product already decided; this plan may point at it, not reopen it) |
| PR [#886](https://github.com/agent-kit-startup/agent-kit-dev/pull/886) | PR | Merged 2026-09-11. Ingested into the ADR above | none |
| `origin/docs/dogfood-orquestracao-entre-repos` | branch | Leftover remote after merged #886. **Deleted** in Phase 2. Tip was `d15b294c` (empty diff vs squash `312d9b68`) | none (closed) |
| `dogfood/cursor_orquestracao_entre_repos_e_superficie_humana_20260911.md` | dogfood | Processed 2026-09-15 (Park: ADR 2026-09-15). Listed under Processed in `dogfood/README.md`. Unprocessed inbox: empty | none (ingested) |
| `docs/five-layer-claim-matrix.md` (and private `docs/evidence/five-layer-claim-matrix.md`) | doc | Context + memory layer non-claim: not a hosted control plane or cloud HANDOFF sync. Unsupported list item 3 restates the same | none (already states the non-claim) |
| `docs/product-context/mission-kit-basic-vs-advanced.md` | doc | Advanced row **L1 memory consolidation**: Phase 1 candidate, not included in Basic, not shipped. Multi-project fleet status cites ADR 2026-09-15 (out of kit as a shared board) | none (candidate record; this plan does not unlock L1) |
| `.cursor/memory/decisions/2026-09-03_mission-kit-monetization-model.md` | ADR | Accepted sequenced hybrid. Phase 1 candidates include memory consolidation. Phase 2 is hosted paid MCP after the marketplace gate | none (sequencing stands; this plan does not ship entitlement) |
| Hosted paid MCP spec (private factory doc) | doc | Spec only. Team context store is paid Phase 2 (encrypted team context DB). Hard marketplace gate is not green. Implementation / billing unchecked | none (gated; do not build) |
| `docs/evidence/cross-repo-parity.md` | doc | BIGFIX public-vs-private release evidence (lane SHAs, npm, public-sync). Not memory sync | none (wrong theme) |
| Ashes to Ashes / L0 consolidation | ADR | ADR `2026-09-04_major-tom-autonomous-mode.md` (amended 2026-09-10): Ashes to Ashes withdrawn from the kit. Shipping memory consolidation in L0 was rejected (contradicts 2026-09-03). Codename remains in `2026-09-04_major-tom-space-oddity-codenames.md` | none (in-kit run consolidation is not this residual; L0 engine not shipped) |
| Cursor AgentStores / user store | none | Repo grep over `md` / `json` / `ts` / `js` / `mdc`: **zero** kit mentions. Host IDE state, not the memory loop | none / not a kit surface |
| `.cursor/plans/kitchan-forum.plan.md` | plan | Shared forum on `chan.missionkit.io`. Phase 3 in progress: remaining Hostinger seed and authenticated post. Not a HANDOFF replacement | **adjacent-not-owner** |
| `.cursor/plans/archive/mission-kit-hosted-harness-product.plan.md` | plan | Paper complete (nine to-dos completed, PR #921). Implementation gate unsatisfied (`docs/product-context/hosted-harness-implementation-gate.md`). Advanced line cites L1 memory consolidation. ADR `2026-09-17_hosted-harness-stateless-control-plane.md` stays **Proposed** | **adjacent-not-owner** (archived path; do not treat as this residual's owner) |
| `.cursor/memory/plan-monitor-mission-kit-hosted-harness-product.md` | memory | Post-hoc monitor for the hosted-harness paper (PR #921). Gate not satisfied | adjacent-not-owner |
| `docs/capability-inventory.md` | doc | Points at the five-layer matrix. Records per-checkout `memory-loop.mdc`. Does not claim a fleet HANDOFF or AgentStore | none (indicative inventory) |
| `CHANGELOG.md` `[Unreleased]` | doc | This plan's Changed bullet added in Phase 2. Landing hero copy refresh (zip 7 v2) left intact. Landing `phase5-docs` still pending | this plan (changelog only; did not rewrite landing hero) |
| `cross-repo-memory-inventory-consolidate.plan.md` | plan | Backlog enqueue for inventory + pointer sync only | this plan (Phases 0-2 as written; not a product unlock) |

## Adjacent boards (named reads only)

**Kitchan** owns a shared message board for agents and humans on operator Hostinger infra (`infra/kitchan/`). HANDOFF stays the session channel; Kitchan is a complement, not a second memory loop. Remaining work is seed/auth on the live host, not pointer consolidation in this file.

**Hosted harness** (archived plan path above) owns paper for a possible later hosted control plane. Durable state in that proposal stays in the user's git. Team context in the Proposed ADR is not a kit-hosted HANDOFF dump. Implementation remains blocked on the three-criterion gate (none satisfied as of 2026-09-17). This residual does not accept that ADR and does not start hosted code.

Neither board owns inventory of duplicate, competing, or outdated cross-repo memory artifacts, or the pointer-sync residual.

## Docs SoT named in Broad Intake

| Doc | What it already says about this theme | Pointer edit |
|-----|----------------------------------------|--------------|
| `docs/product-context/mission-kit-basic-vs-advanced.md` | L1 memory consolidation = Advanced candidate. Fleet shared board out of kit (cites 2026-09-15) | Phase 1: adjacent-not-owner anti-promise |
| `docs/five-layer-claim-matrix.md` | Not a hosted control plane or cloud HANDOFF sync | Phase 1: per-checkout + no fleet board (2026-09-15) |
| `docs/capability-inventory.md` | Local memory loop; five-layer citations | Phase 1: per-checkout bound on `memory-loop.mdc` |
| Hosted paid MCP documentation | Hosted team context store = R2, gated | No (non-goal only) |
| `CHANGELOG.md` `[Unreleased]` | Landing hero copy refresh (zip 7 v2) already listed. Landing `phase5-docs` still pending | No (Phase 2 owns a public bullet if this plan shipped docs) |

Phase 1 applied the pointers below. This inventory file stays check-first; it does not unlock product.

## Non-goals

This enqueue does **not** own:

1. **AgentStore / user-store product.** Cursor AgentStores are host IDE state. The kit does not mention them as a memory loop and must not grow one.
2. **Hosted team-context DB.** Hosted paid MCP documentation, Phase 2 after the marketplace gate. Do not implement.
3. **L1 memory-consolidation unlock.** Monetization Phase 1 candidate. Major Tom Ashes to Ashes no longer promises it in L0. Do not ship the engine from this plan.
4. **Fleet HANDOFF board.** Discarded by ADR 2026-09-15. Do not reopen. Kitchan is adjacent forum infra, not a replacement board.

Phase 1 restates these non-goals in the public five-layer matrix, `docs/capability-inventory.md`, and the basic-vs-advanced extract. The parked fleet alternative is not reopened.

## Phase 1 pointers applied

| Target | Pointer |
|--------|---------|
| `docs/five-layer-claim-matrix.md` | Context+memory non-claim and unsupported item 3 now name per-checkout memory and no fleet HANDOFF board (2026-09-15). Public page: no private memory path. |
| `docs/capability-inventory.md` | `memory-loop.mdc` line names per-checkout bound, not a fleet board or host AgentStore; L1 consolidation stays a candidate. |
| `docs/product-context/mission-kit-basic-vs-advanced.md` | Anti-promise: Kitchan and hosted-harness paper are adjacent-not-owner; this residual does not unlock L1, hosted team context, or AgentStore. Fleet row already cited 2026-09-15. |
| `.cursor/memory/_index.md` | Existing ADR 2026-09-15 row gained tags `inventory-pointer-2026-09`, `adjacent-not-owner`. No second fleet ADR. |
| `kitchan-forum.plan.md` / archived hosted-harness plan | Not mutated. Adjacent-not-owner only. |

## Phase 2 leftover git hygiene (closed)

- **Closed:** deleted remote `origin/docs/dogfood-orquestracao-entre-repos` after merged PR #886. Squash `312d9b68` is on `staging`. Leftover tip `d15b294c` had an empty diff versus that squash (not an ancestor SHA, squash merge).
- Unrelated remotes and dirty `plan-monitor-*.md` files were not folded into this step.

## Hygiene observation (later commits)

Broad Intake (2026-09-20) recorded unrelated dirty `plan-monitor-*.md` plus `_index.md`. This scan's working tree is clean. The rule still holds: unrelated monitors stay out of this plan's later commits (add-by-name only if this plan creates a monitor). Public-tree guard: do not commit the plan file or HANDOFF.

## Standing constraints (not reopened)

- Memory loop remains per-checkout `.cursor/memory/` (`memory-loop.mdc`).
- A phase in repo A does not schedule work in repo B (ADR 2026-09-15).
- Never `/git-prod` from this plan.
- Landing Unreleased hero copy is owned by the landing board, not this residual.
