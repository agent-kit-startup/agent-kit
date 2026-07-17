# Public launch — go/no-go

Checklist before promoting or advertising the public mirror ([agent-kit-startup/agent-kit](https://github.com/agent-kit-startup/agent-kit)). Complements [repository-boundaries.md](repository-boundaries.md) and `scripts/sync-public.mjs`.

## History mode (decision)

| Mode | Behavior | When |
|------|----------|------|
| **append-only** (default) | Clone public → replace allowlisted tree → commit → push (no force) | Normal sync; required for community PRs / watches (Fase 7) |
| **force-snapshot** | `git init` + force-push | Escape hatch only (`--force-snapshot`) |

Recorded in `.cursor/memory/decisions/2026-07-16_public-history-append-only.md`.

## Go/no-go

| Item | Status |
|------|--------|
| README EN with framework + HITL + anti-slop thesis | ✅ root `README.md` |
| Internal coherence (`f6-coherence`) — registry skill SoT, no stack `alwaysApply: true` | ✅ [coherence-inventory.md](coherence-inventory.md) |
| Core structural only; PM/n8n optional | ✅ |
| `/git-staging` + `/git-prod` with explicit prod confirmation | ✅ |
| Allowlist audited (`node scripts/sync-public.mjs --dry-run`) | ✅ no HANDOFF/plans/memory in set |
| Dogfood on this repo (plan, HANDOFF, staging→prod, memory) | ✅ |
| Public sync append-only by default | ✅ `scripts/sync-public.mjs` |
| `PUBLIC_REPO_URL` secret on private CI | ⏳ ops — required for live sync |
| Fase 7 registry-on-public topology | ✅ spec [topology-private-public.md](topology-private-public.md); cutover ops still open |
| Final plan review (`review-camadas`) | ✅ [review-camadas.md](review-camadas.md) |

**Launch gate:** all ✅ rows above plus CI secret configured. Do not advertise community contribution until append-only sync has run at least once against the public remote.

## Dry-run

```bash
node scripts/sync-public.mjs --dry-run
# Review every path; prohibited patterns must not appear.
```

## Sync (HITL)

After `git prod` on the private repo (or `workflow_dispatch`):

```bash
# default append-only
node scripts/sync-public.mjs --url "$PUBLIC_REPO_URL"

# nuclear rebuild only if public history must be discarded
node scripts/sync-public.mjs --force-snapshot --url "$PUBLIC_REPO_URL"
```
