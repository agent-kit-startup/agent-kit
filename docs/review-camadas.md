# Review - camadas & orquestração (`review-camadas`)

Final coherence pass against the active plan thesis (HITL, hygiene, structural vs stack, public go/no-go). Date: 2026-07-16.

## Verdict

**Pass with residuals.** The plan’s implementable to-dos are done. Dogfood continues. Open items are **ops/HITL**, not product contradictions.

## Checklist

| Criterion | Result | Evidence |
|-----------|--------|----------|
| HITL: prod only with explicit confirmation | ✅ | `git-prod.md`, `autogit/gitupdate.md`; loop/orquestrado forbid `/git-prod` |
| Loop/orquestrado never promote to main | ✅ | command docs + plan-routine |
| Core structural; no stack `alwaysApply: true` | ✅ | scan of `.cursor/rules/*.mdc` |
| Registry SoT for skills; workspace = install | ✅ | `f6-coherence`, `docs/coherence-inventory.md` |
| Contribute gate anti-slop | ✅ | `agent-kit contribute` + CONTRIBUTING |
| Public README thesis EN | ✅ | root `README.md` |
| Public history append-only default | ✅ | `sync-public.mjs`; decision memory |
| Topology Phase A/B documented | ✅ | `docs/topology-private-public.md` |
| Marketplace versioning | ✅ | skill frontmatter + `registry.json` |
| Paid MCP does not capture free core | ✅ | paid MCP spec (private) gate + non-goals |
| Fleet migrated off nested `agent-kit/` | ✅ | example + frota; `docs/migrate-consumer.md` |

## Residuals (not blockers for plan close)

1. **`PUBLIC_REPO_TOKEN`** on private CI - required for PR-based public sync ([public-launch.md](public-launch.md)).
2. **Phase B cutover** - stop mirroring `registry/**` when contribution-on-public goes live.
3. **Cursor Marketplace submission** - publisher HITL.
4. **Paid MCP implementation** - blocked until marketplace gate green.
5. **Private consumer workspaces** - out of scope for this pass.

## Contradictions found

None that reverse HITL, hygiene, or structural-vs-stack. Public sync behavior is append-only by default ([public-launch.md](public-launch.md)).

## Recommend next human actions

1. Review the staging branch before promotion.
2. When ready: **`/git-prod`** with explicit confirmation (staging → main + public sync if secret set).
3. Keep dogfooding the kit on day-to-day work.

## Acceptance

- [x] Review recorded
- [x] No HITL/gate regressions found
- [x] Residuals listed as ops, not reopened product scope
