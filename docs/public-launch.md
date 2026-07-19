# Public launch - go/no-go

Checklist before promoting or advertising the public mirror ([agent-kit-startup/agent-kit](https://github.com/agent-kit-startup/agent-kit)). Complements [repository-boundaries.md](repository-boundaries.md) and `scripts/sync-public.mjs`.

## History mode (decision)

| Mode | Behavior | When |
|------|----------|------|
| **append-only PR** (default) | Clone `main` → replace allowlisted tree → push sync branch → open PR | Normal sync; compatible with protected `main`, community PRs, and watches |
| **direct** | Clone public → replace allowlisted tree → push directly to `main` | Migration only, before branch protection (`--direct`) |
| **force-snapshot** | `git init` + force-push | Escape hatch only (`--force-snapshot`) |

Decision recorded in the maintainers' decision log (private repo memory).

## Go/no-go

| Item | Status |
|------|--------|
| README EN with framework + HITL + anti-slop thesis | ✅ root `README.md` |
| Internal coherence (`f6-coherence`) - registry skill SoT, no stack `alwaysApply: true` | ✅ [coherence-inventory.md](coherence-inventory.md) |
| Core structural only; PM/n8n optional | ✅ |
| `/git-staging` + `/git-prod` with explicit prod confirmation | ✅ |
| Allowlist audited (`node scripts/sync-public.mjs --dry-run`) | ✅ no HANDOFF/plans/memory in set |
| Dogfood on this repo (plan, HANDOFF, staging→prod, memory) | ✅ |
| Public sync opens an append-only PR by default | ✅ `scripts/sync-public.mjs` |
| GitHub About description and topics | ✅ aligned with [github-about.md](github-about.md) |
| `PUBLIC_REPO_TOKEN` secret on private CI | ⏳ ops - requires Contents + Pull requests + Workflows write on the public repo |
| Public `main` ruleset | ✅ active (`Protect main` - PR + 1 approval + check `build`) |
| Fase 7 registry-on-public topology | ✅ spec [topology-private-public.md](topology-private-public.md); cutover ops still open |
| Final plan review (`review-camadas`) | ✅ [review-camadas.md](review-camadas.md) |

**Launch gate:** all ✅ rows above, CI token configured, and the `main` ruleset active. Do not advertise community contribution until the PR-based sync has completed once.

## Public branch policy

The public repository uses a single long-lived branch, `main`. Contributors work in forks or short-lived branches and open PRs directly to `main`; the private repository keeps the separate `staging` → `main` release flow.

Configure a repository ruleset targeting `main`:

- require a pull request with one approval;
- require the `build` status check and an up-to-date branch;
- require resolved conversations;
- block force pushes and branch deletion;
- allow squash merge and delete merged branches automatically.

Do not require a merge queue or signed commits until contribution volume or release risk justifies the added friction. Protect `v*` tags from updates and deletion in a separate tag ruleset.

## Dry-run

```bash
node scripts/sync-public.mjs --dry-run
# Review every path; prohibited patterns must not appear.
```

## Sync (HITL)

After `git prod` on the private repo (or `workflow_dispatch`):

```bash
# default: push a sync branch and open a PR
node scripts/sync-public.mjs --url "$PUBLIC_REPO_URL"

# migration only, before main is protected
node scripts/sync-public.mjs --direct --url "$PUBLIC_REPO_URL"

# nuclear rebuild only if public history must be discarded
node scripts/sync-public.mjs --force-snapshot --url "$PUBLIC_REPO_URL"
```
