# Repository boundaries (local × Git × npm)

Agent Kit separates session state from product code. Local development state (plans, handoff, memory) stays on your machine; the public remote and the npm package only carry product code and documentation.

**Target topology (Fase 7):** see [topology-private-public.md](topology-private-public.md) - public becomes the **canonical registry**; private keeps CLI/core and promotes mature artifacts.

## Repositories (canonical)

| Role | Repository | Git remote | Notes |
|------|------------|------------|-------|
| **Private** | [agent-kit-startup/agent-kit-dev](https://github.com/agent-kit-startup/agent-kit-dev) | `origin` | Core product SoT (CLI, feats, sync). Phase A also authors registry. |
| **Public** | [agent-kit-startup/agent-kit](https://github.com/agent-kit-startup/agent-kit) | sync / community PRs | Phase A: allowlist mirror. Phase B: **registry SoT** + contribution surface. |
| **npm** | `@agent-kit/cli` | Publish on `v*` tags when `NPM_TOKEN` is configured | Dist only |

## Flow: `git staging` → `git prod` → público

1. **`git staging`** - PR para `staging` no **privado** (`agent-kit-dev`). Tudo que for commitado vai para o privado.
2. **`git prod`** - `staging` → `main` no **privado**; push `origin main`.
3. **Espelho público (integrado ao `git prod`)** - Com remote `public` apontando ao repositório GitHub público e `gh` autenticado, após o push de `main` roda-se **`pnpm git:trigger-public-sync`** (ou `bash scripts/trigger-public-sync-after-prod.sh`): dispara o workflow **CI** no **origin** com *Sync to public repo* → CI executa **build** e abre um PR de sync no público (requer secret `PUBLIC_REPO_TOKEN` no privado). Ver passo 12 do "Prompt: git prod" em `autogit/gitupdate.md`.
4. **Alternativas** (release ou fallback): tag SemVer `v*` no privado; *workflow_dispatch* manual no Actions; `node scripts/sync-public.mjs` com URL/token no ambiente.

Sem `PUBLIC_REPO_TOKEN` configurado no GitHub do **privado**, o job de sync não empurra nada - o restante do CI segue normal.

### Public launch checklist

1. Garantir o repositório público vazio (sem README inicial se quiser histórico só a partir do primeiro sync).
2. Criar um fine-grained token limitado ao repositório público, com `Contents: write`, `Pull requests: write` e `Workflows: write`; guardar como `PUBLIC_REPO_TOKEN`.
3. Opcional: `git remote add public https://github.com/agent-kit-startup/agent-kit.git` no clone para testes locais.
4. Rodar sync: tag `v*` ou *workflow_dispatch* conforme o workflow.
5. README, licença e política de PRs no repositório **público** (issues/PRs externos; patches sensíveis só no dev).

## Two remotes - private and public

**Phase A (current):** private authors product + registry; public is an allowlist mirror (append-only sync).

**Phase B (target):** public owns `registry/**`; private syncs CLI/docs/L0 samples only and **consumes** the public registry URL.

```
Phase A: Local → agent-kit-dev → sync-public → agent-kit (incl. registry)
Phase B: Local → agent-kit-dev → sync-public → agent-kit (excl. registry)
         Fleet / private CLI ──install/add──► agent-kit registry (canonical)
         promote / contribute ──PR──► agent-kit
```

| Surface | What goes in | What stays out |
|---------|--------------|----------------|
| **Local working tree** | Cursor plans, `HANDOFF.md`, active context packs, optional `.cursor/memory/` | - |
| **Private repo** | CLI, feats, sync scripts, dogfood; Phase A also registry | - |
| **Public repo** | Allowlist (`scripts/public-sync.manifest`); Phase B + community PRs on registry | Session state, credentials, private-only tooling |
| **npm (`@agent-kit/cli`)** | Only `packages/cli/dist` (`files` in `package.json`) | Monorepo templates and `.cursor/` are not in the tarball |

### Phase B cutover (ops)

1. Freeze registry edits on private (PRs go to public only).
2. Ensure public `registry/**` matches private (final sync including registry).
3. Add `!registry/**` to `scripts/public-sync.manifest` (or remove the include).
4. Document in CHANGELOG; point `agent-kit contribute` / CONTRIBUTING at public PRs.
5. Private dogfood: `update` against public URL/ref.

### How sync works

1. **Manifest** - `scripts/public-sync.manifest` lists allowed globs (positive allowlist).
2. **Script** - `scripts/sync-public.mjs` reads the manifest, filters `git ls-files`, checks no forbidden path slipped through, and opens an append-only PR against public `main` (default). `--direct` is migration-only; `--force-snapshot` rewrites public history. See [public-launch.md](public-launch.md).
3. **CI** - the `sync-public` job in `.github/workflows/ci.yml` runs the script on `v*` tags or via `workflow_dispatch`.

### Required CI secrets (no repositório privado `agent-kit-dev`)

| Secret | Purpose |
|--------|---------|
| `PUBLIC_REPO_TOKEN` | Fine-grained token limited to the public repo, with `Contents: write`, `Pull requests: write`, and `Workflows: write` (required when the sync tree includes `.github/workflows/`) |
| `NPM_TOKEN` | Token to publish to the npm registry |

Optional repository variable `PUBLIC_REPO_URL` overrides the default public Git URL without embedding credentials.

### External contributions

- **Phase A:** external PRs on public; maintainers merge and, if needed, promote-back into private before the next sync overwrites registry paths.
- **Phase B:** registry PRs land **only** on public; `agent-kit contribute` targets public; private no longer mirrors registry.

## Why

- Plans and handoff are **session state** - they change per conversation and agent; versioning them on the public remote clutters history and can leak internal drafts.
- Memory (`.cursor/memory/`) holds project-specific decisions and fixes - it does not belong on the public mirror.
- CI fails if `.cursor/HANDOFF.md` or `.cursor/plans/**/*.plan.md` are tracked (guard in `.github/workflows/ci.yml`).
- Relying only on `.gitignore` + human review is fragile (`git add -f`, new paths, old history). The **positive allowlist** is the main defense.

## Contributing

Respect `.gitignore` and do not use `git add -f` to bypass these paths. See also [CONTRIBUTING.md](CONTRIBUTING.md).
