# Agent Kit — Instalação

> **Você é o instalador.** Monte o kit **no projeto do usuário** sem copiar o monorepo Agent Kit para dentro dele.

## Contrato (obrigatório)

1. **Proibido:** criar ou manter uma pasta `agent-kit/` com o repo inteiro (CLI, `packages/`, `node_modules`, etc.) dentro do projeto consumidor.
2. **Obrigatório:** layout de bootstrap mínimo — ver [docs/bootstrap.md](docs/bootstrap.md).
3. **Resultado:** `.cursor/` com L0 + `.cursor/agent-kit.json` + `autogit/` na raiz do projeto.

## Preferência: CLI

Se Node.js estiver disponível, na **raiz do projeto consumidor**:

```bash
npx @agent-kit/cli install
# packs L1 opcionais:
npx @agent-kit/cli install --pack clean-code,gestao-contexto
```

Com checkout local do monorepo Agent Kit:

```bash
pnpm --filter @agent-kit/cli start install --cwd /caminho/do/projeto
```

Depois: `agent-kit status` (ou o equivalente via `pnpm --filter @agent-kit/cli start status --cwd …`).

Se a CLI rodar com sucesso, pule para **Onboarding** abaixo.

## Porta B: instalar via chat (sem CLI)

Quando o usuário arrastar este arquivo ou usar `@install.md` e a CLI não estiver disponível:

### 1. Criar estrutura mínima (L0 + sessão)

```
.cursor/
├── agent-kit.json
├── rules/          # rules L0 listadas abaixo
├── commands/       # commands L0
├── hooks/
│   └── pre-commit/
│       └── check-secrets.sh
├── plans/
├── memory/
├── context/
│   ├── templates/  # opcional: context-pack, handoff, task-brief, adr
│   ├── current/
│   └── archive/
└── HANDOFF.md      # se ainda não existir
autogit/
├── gitupdate.md
└── plan-routine.md
```

**Não** criar árvore completa de skills n8n/SQL/ClickUp por padrão — isso é L2 (`agent-kit add`) ou pack L1.

### 2. Conteúdo L0 (fonte = este repositório / registry)

Copiar **só** estes artefatos (mesmo conteúdo do SoT / registry), não o monorepo:

| Destino | Fonte no kit |
|---------|----------------|
| `.cursor/rules/cursor-plan-handoff.mdc` | `.cursor/rules/cursor-plan-handoff.mdc` |
| `.cursor/rules/context-guardian.mdc` | idem |
| `.cursor/rules/cursor-skills-git-workflow.mdc` | idem |
| `.cursor/rules/cursor-skills-general.mdc` | idem |
| `.cursor/rules/ux-tone.mdc` | idem |
| `.cursor/rules/agent-output-hygiene.mdc` | idem |
| `.cursor/rules/docs-professional-standard.mdc` | idem |
| `.cursor/rules/memory-loop.mdc` | idem |
| `.cursor/commands/iniciar-projeto.md` | idem |
| `.cursor/commands/continuar-plano.md` | idem |
| `.cursor/commands/executar-plano-loop.md` | idem |
| `.cursor/commands/executar-plano-orquestrado.md` | idem |
| `.cursor/commands/handoff.md` | idem |
| `.cursor/commands/resumo.md` | idem |
| `.cursor/commands/git-staging.md` | idem |
| `.cursor/commands/git-homolog.md` | idem |
| `.cursor/commands/git-prod.md` | idem |
| `.cursor/hooks/pre-commit/check-secrets.sh` | idem |
| `autogit/gitupdate.md` | `autogit/gitupdate.md` |
| `autogit/plan-routine.md` | `autogit/plan-routine.md` |

Se o agente tiver o monorepo Agent Kit aberto como workspace, use esses paths. Se estiver só no projeto consumidor, peça ao usuário a URL/ref do registry ou use `npx @agent-kit/cli install`.

### 3. Manifest `.cursor/agent-kit.json`

Criar se não existir (ajustar `version` / `registry` ao SoT atual):

```json
{
  "schemaVersion": 1,
  "version": "3.0.0",
  "profile": "default",
  "packs": [],
  "skills": [],
  "protected": [
    ".cursor/HANDOFF.md",
    ".cursor/plans/**",
    ".cursor/memory/**",
    ".cursor/context/**"
  ],
  "registry": {
    "url": "https://github.com/agent-kit-startup/agent-kit",
    "ref": "main"
  }
}
```

Schema: [docs/agent-kit-manifest.md](docs/agent-kit-manifest.md).

### 4. HANDOFF (primeira instalação)

Se **não** existir `.cursor/HANDOFF.md`, criar a partir de `HANDOFF.md.example` ou `.cursor/context/templates/handoff.md`.

### 5. Hooks Git (opcional)

```bash
# secrets (se o projeto já usa pre-commit custom, integrar check-secrets.sh)
cp .cursor/hooks/pre-commit/check-secrets.sh .git/hooks/  # só se o fluxo do repo exigir

# prepare-commit-msg: copiar o *arquivo* do registry, nunca a pasta agent-kit/
# fonte no kit: git-hooks/prepare-commit-msg → .git/hooks/prepare-commit-msg
```

### 6. Onboarding (primeira instalação)

Se não existia HANDOFF antes:

1. Boas-vindas curtas ao Agent Kit (handoff + planos).
2. Comandos: `/iniciar-projeto`, `/handoff`, `/continuar-plano`, `/git-staging`, `/git-prod`.
3. Perguntar se quer criar o primeiro plano.

Se já existia estrutura: confirmar e listar os mesmos comandos.

### 7. Migrar cópia antiga

Se o projeto ainda tiver `agent-kit/` aninhado: preservar L3, instalar via CLI/manifest, depois **apagar** a pasta aninhada. Detalhes: [docs/bootstrap.md](docs/bootstrap.md).

---

## O que NÃO instalar por padrão

- Rules/skills de stack (n8n, SQL, Node, PM tools) — `agent-kit add` ou `--pack`
- Subárvore `packages/`, `node_modules`, `pnpm-lock` do kit
- CLI `cursor-handoff` legado como requisito — preferir `@agent-kit/cli`

## Referências

- [docs/bootstrap.md](docs/bootstrap.md) — contrato de bootstrap
- [docs/layers-spec.md](docs/layers-spec.md) — L0–L3
- [docs/getting-started.md](docs/getting-started.md) — comandos de lifecycle
