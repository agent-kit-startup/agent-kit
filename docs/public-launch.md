# Public launch - go/no-go

Checklist before promoting or advertising the public mirror ([agent-kit-startup/agent-kit](https://github.com/agent-kit-startup/agent-kit)). For topology and cutover status, see [topology-private-public.md](topology-private-public.md). Ready-to-paste launch copy: [public-launch-announcement.md](public-launch-announcement.md).

## History mode (decision)

| Mode | Behavior | When |
|------|----------|------|
| **append-only PR** (default) | Clone `main` → replace allowlisted tree → push semantic head (`sync/vX.Y.Z-<shortsha>`) → open or update PR; close superseded `sync/*` PRs | Normal sync; compatible with protected `main`, community PRs, and watches |
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
| Public `main` ruleset | ✅ active (`Protect main` - PR + 1 approval + Admin bypass + check `build`) |
| Fase 7 registry-on-public topology | ✅ spec [topology-private-public.md](topology-private-public.md); cutover ops still open |
| Final plan review (`review-camadas`) | ✅ [review-camadas.md](review-camadas.md) |

**Launch gate:** all ✅ rows above, CI token configured, and the `main` ruleset active. Do not advertise community contribution until the PR-based sync has completed once.

## Public branch policy

The public repository uses a single long-lived branch, `main`. Contributors work in forks or short-lived branches and open PRs directly to `main`; the private repository keeps the separate `staging` → `main` release flow.

Configure a repository ruleset targeting `main`:

- require a pull request with one approval (community PRs);
- **bypass actors:** Repository Admin (`always`) so a solo maintainer and the sync operator can land private→public sync PRs without a second reviewer;
- require the `build` status check and an up-to-date branch;
- require resolved conversations;
- block force pushes and branch deletion;
- allow squash merge and delete merged branches automatically.

Without the Admin bypass, a single-owner repo deadlocks: you cannot approve your own sync PR, and `--admin` merge still fails on `REVIEW_REQUIRED`.

Do not require a merge queue or signed commits until contribution volume or release risk justifies the added friction. Protect `v*` tags from updates and deletion in a separate tag ruleset.

## External PR threat model

Contributors work from forks and submit PRs directly to the public `main` branch. The repository controls enforce these mitigations against malicious PRs:

### Required review and build checks

- All PRs require approval from a maintainer (cannot self-approve)
- CI must pass (`build` job: lint, typecheck, test, build)
- Branch must be up-to-date with `main`

### Workflow and dependency risks

**Dependency confusion:** PRs cannot modify `package.json` dependencies without maintainer review detecting suspicious packages or version downgrades.

**Workflow injection:** Contributors cannot modify `.github/workflows/` or add new workflows since these paths are not in the public sync allowlist. CI workflows remain controlled by the private repository.

**Secret exfiltration attempts:** The public repository contains no secrets. CI jobs on external PRs run in a restricted context with limited access to repository secrets.

### Sync preservation

The allowlist sync from private to public preserves maintainer-controlled paths and overwrites contributor changes to protected areas during each sync operation. External PRs can only persistently modify files within the public-writable subset (primarily registry skills and documentation).

### Maintainer responsibilities

When reviewing external PRs, watch for:
- Unexpected changes to `package.json`, `pnpm-lock.yaml`, or build configuration
- New dependencies from untrusted sources or with suspicious version patterns  
- Code that attempts filesystem access beyond expected skill operations
- Documentation changes that introduce external links to untrusted domains
- Skill submissions that request unusual permissions or network access

## Dry-run

```bash
node scripts/sync-public.mjs --dry-run
# Review every path; prohibited patterns must not appear.
```

## Sync (automated)

After `git prod` on the private repo, the pipeline automatically:

1. **Creates annotated vX.Y.Z tag** (triggers npm publish + sync-public jobs)
2. **Opens sync PR** with semantic body: Summary + CHANGELOG release notes + source SHA
3. **Auto-merges PR** after required checks pass (`gh pr merge --auto`)

Opt-out: Set `PUBLIC_SYNC_AUTO_MERGE=false` to require manual merge.

Manual fallback:
```bash
# workflow_dispatch when tag-based trigger is insufficient
pnpm git:trigger-public-sync

# direct commands (rare)
node scripts/sync-public.mjs --url "$PUBLIC_REPO_URL"
node scripts/sync-public.mjs --direct --url "$PUBLIC_REPO_URL"  # migration only
node scripts/sync-public.mjs --force-snapshot --url "$PUBLIC_REPO_URL"  # escape hatch
```
