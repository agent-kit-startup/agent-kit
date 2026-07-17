# Topology — private × public × paid (Fase 7)

Target architecture for Agent Kit distribution and contribution. Complements [repository-boundaries.md](repository-boundaries.md) and [public-launch.md](public-launch.md).

## Roles

| Surface | Repo | Owns | Does not own |
|---------|------|------|----------------|
| **Private** | `agent-kit-dev` | CLI (`packages/`), generators, CI secrets, sync tooling, roadmap/plans, experiments, dogfood session state | Canonical registry after cutover |
| **Public** | `agent-kit` | **Canonical registry** (`registry/**`), L0 samples under `.cursor/{rules,commands,hooks}`, packs, docs consumers need, CONTRIBUTING + PR gate | Private history, HANDOFF, memory, plans |
| **Paid (R2)** | MCP product | Managed updates, premium/private packs, team context | Free static registry (stays public) |

```text
Private (core + feats) ──promote mature artifact──► Public registry (PRs + tags)
       ▲                                              │
       │ consume registry URL                         │ agent-kit install/add/update
       └────────────── Fleet projects ◄───────────────┘
                              │
                              └── agent-kit contribute → PR to Public
```

## Phases

### Phase A — today (mirror)

- Registry **authored** in private; `scripts/sync-public.mjs` copies allowlist (including `registry/**`) to public with **append-only** history.
- Fleet may already resolve remote registry via public URL (`DEFAULT_REGISTRY_URL` → `agent-kit`).
- Community PRs on public are possible but can be overwritten if private re-syncs the same paths — treat public registry edits as needing a **promote-back** into private until Phase B.

### Phase B — registry-canonical public (cutover)

1. **Stop** syncing `registry/**` from private → public (manifest exclusion).
2. Public `registry/**` becomes the only write path for skills/packs (PRs + maintainers).
3. Private **consumes** public registry like any consumer (`--url` / cache) when developing CLI; optional local `registry/` checkout for offline tests only (not SoT).
4. Promote flow for new artifacts invented in private: open PR **to public** (same gate as `agent-kit contribute`).
5. Sync allowlist keeps CLI, docs, templates, L0 samples — product code still ships private → public without carrying registry mutations.

### Phase C — marketplace + paid

- `f7-marketplace` — ✅ catalog versioning + gate docs ([marketplace.md](marketplace.md)); live Marketplace submission = ops/HITL.
- `f7-mcp-pago` — ✅ product spec (private doc); implementation gated on free marketplace.

## Manifest adjustments

| Glob | Phase A | Phase B |
|------|---------|---------|
| `registry/**` | included (mirror) | **excluded** from private→public sync |
| `packages/**`, `docs/**`, L0 `.cursor/**` samples | included | included |
| Session paths | always excluded | always excluded |

Cutover checklist lives in the “Phase B cutover” section of [repository-boundaries.md](repository-boundaries.md). Until cutover, keep `registry/**` in `scripts/public-sync.manifest` (Phase A).

## Promote mature artifact (runbook)

When a skill/pack/rule is ready to leave private experiments:

1. Ensure content passes contribute gate (hygiene, no secrets, no session state).
2. Prefer `agent-kit contribute --write` from a consumer **or** copy into a branch that targets **public** `agent-kit`.
3. Open PR → `main` (public) with Conventional Commits; update `registry/registry.json` via `node scripts/build-registry.mjs` in that tree.
4. Tag / release on public as needed for fleet pins.
5. Private dogfood: `agent-kit update --url https://github.com/agent-kit-startup/agent-kit --ref <tag>`.

Do **not** `/git-prod` as part of promote; private prod remains HITL for CLI releases.

## CLI defaults

- Remote registry default URL already points at the **public** repo (`packages/cli` `DEFAULT_REGISTRY_URL`).
- After Phase B, private CI should not treat local `registry/` as publish SoT — only as optional cache.

## Acceptance (`f7-topologia-repos`)

- [x] Target topology documented (this file + boundaries)
- [x] Phase A vs B sync rules for `registry/**` explicit
- [x] Promote runbook written
- [ ] Phase B cutover executed (ops: exclude `registry/**` from manifest + first public-only registry PR) — tracked as follow-up when launching contribution
