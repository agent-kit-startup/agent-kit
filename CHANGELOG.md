# Changelog - Agent Kit

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

## [3.5.1] - 2026-07-19

### Added

- `pre-push` authorized prod path: `ALLOW_MAIN_PUSH=1 git push origin main` (keeps the hook on; preferred over `--no-verify` for `/git-prod`). Documented in `git-hooks/README.md` and `autogit/gitupdate.md`.

### Changed

- Docs inventories (`coherence-inventory`, `drift-inventory`) and `git-autogit` agent aligned to English command names; legacy homolog alias references removed from live surfaces.

## [3.5.0] - 2026-07-19

### Adicionado

- Guardas de hook `git-hooks/pre-commit` e `git-hooks/pre-push`: bloqueiam commit e push direto em `main`/`master`; `git-hooks/README.md` documenta instalação e o override pontual (`--no-verify`).
- **Native Cursor hooks (L0):** `.cursor/hooks.json` + `.cursor/hooks/agent/` (`sessionStart` injeta HANDOFF + hard rules; `preCompact` avisa handoff). Soft rules sozinhas não bastavam no dogfood. Documentado em `docs/layers-spec.md`, `docs/getting-started.md`, `docs/bootstrap.md`.

### Alterado

- Native hooks: removed `stop` follow-up (`stop-phase-guard.py`) so `/git-staging` / `/git-prod` HITL is not interrupted; keep `sessionStart` + `preCompact`. Session hard rules note that HITL slash commands keep the turn.
- Orchestrated routing: worker signal → `subagent_type` table and fallback in `/run-plan-orchestrated`; optional plan todo `worker_type` in `autogit/plan-routine.md` and plan template.
- Agent install orphans: `docs-repo` agent added to L1 `engenharia-arquitetura` (skill + agent, clean-code pattern); `git-autogit` and thin stack agents (`json-guardian`, `prompts-agents`, `n8n-workflows`, `sql-schema`) documented as dogfood-only / skill-first in `docs/domain-packs.md` and `docs/coherence-inventory.md`. Registry regenerated.
- README: reescrito para versão lean em inglês (~54 linhas), focado no valor principal (contexto persistente + git seguro) e fluxo básico, removendo detalhes internos para aumentar adesão inicial.
- Docs sweep: command names and CLI examples aligned to English (`/start-project`, `/continue-plan`, `agent-kit`, pack ids like `context-management`) across `docs/`, `adicionar-skills.md`, and `.cursor/context/templates/plan.md`.
- Modo manual endurecido: `/start-project` e `/continue-plan` (e rules `cursor-plan-handoff` / `context-guardian`) param após uma fase e não dispensam perguntas de contexto. Multi-fase na mesma janela só via `/run-plan-loop` ou `/run-plan-orchestrated`.
- README: abertura ampliada de "memória de contexto + git seguro" para o escopo real - harness do workflow completo (bootstrap personalizado, plano → execução, integração de PM/automação/infra e DevOps staging-first estruturado que faz os agentes lerem o estado real do projeto). "Why you'd want it" ganha bullets de loop completo e DevOps; produção segue exigindo confirmação.
- Anti-slop: política que elimina o caractere travessão (em dash) de mensagens de commit, textos e docs, mantendo-o apenas em citação literal obrigatória. Novo padrão no skill `clean-code` e reforço nas rules `agent-output-hygiene`, `docs-professional-standard` e `ux-tone`. Scrub aplicado nas rules, skills e docs de face (README, CHANGELOG, `install.md`, `docs/`).
- Spine DevOps reforçado nas rules `cursor-skills-devops` e `cursor-skills-git-workflow`: staging-first (nunca trabalhar em `main`), auditoria first-parent do `main` e poda de branch legada.
- CHANGELOG: links de comparação de versões atualizados (faltavam 3.2.0 a 3.4.0 e o `[Unreleased]` apontava para uma tag antiga).

### Removido

- Branch legada `homologacao` (local e remotos): migrada para `staging`.

## [3.4.0] - 2026-07-19

### Alterado

- README: reescrito em voz de produto para leitor externo - abre pela dor (perder contexto em chats longos), explica handoff/plano/staging→prod em linguagem comum e remove jargão interno do texto (L0, Core Pack, hygiene, spine); tabela de docs descreve cada guia pelo conteúdo.
- `docs/getting-started.md`: reescrito full em voz de produto - install, tabela de comandos em linguagem comum, "a normal day" e seção separada para quem desenvolve o kit.
- `docs/bootstrap.md`: reescrito full - abre pelo layout que o install gera (não pelo anti-pattern); passos de install/update/migração em linguagem comum.
- `docs/domain-packs.md`: reescrito full - explica o que é um pack e para que serve, tabela "what it adds / good for", sem jargão de fase.
- `docs/layers-spec.md` e `docs/agent-kit-manifest.md`: mantêm o modelo L0–L3 (docs de maintainer), mas ganham abertura em linguagem simples e perdem referências de sessão ("Phase 0", "fleet migration", "drift denominator", "f1-/f2-/f6-", seções de "Acceptance").
- `docs/public-launch.md`: checklist marca ruleset de `main` do repositório público como ativo.

## [3.3.1] - 2026-07-18

### Alterado

- README: rewrite slim em inglês - pitch HITL, install L0, fluxo, CLI lifecycle e links; remove inventário de stack (ClickUp/n8n/SQL…) e seção PT duplicada; L0 alinhado a `packages/cli/src/lifecycle/l0.ts`.
- `docs/github-about.md`: Description alinhada à tese HITL (deixa de usar “developer bootstrapper”).
- `docs/public-launch.md` e `docs/repository-boundaries.md`: `PUBLIC_REPO_TOKEN` documenta também `Workflows: write` (sync com `.github/workflows/`).

## [3.3.0] - 2026-07-18

### Alterado

- README: abertura reescrita em voz de produto (princípios HITL, estrutura, hygiene, core vs stack) - remove tabela de posicionamento interno e link para checklist de ops.
- Sync público: `install.md`, `categories.md`, `adicionar-skills.md` e `HANDOFF.md.example` incluídos no manifest - README público os referencia (links quebravam no espelho).
- Política do repositório público: sync passa a abrir PR contra `main` por padrão; CI usa `PUBLIC_REPO_TOKEN`; `main` permanece como única branch longa e recebe ruleset com review + check `build`.
- `docs/CONTRIBUTING.md` e `docs/cursor-3-features.md`: guideline de tooling Cursor-native reescrita em termos genéricos (sem citar gateway específico).
- Hygiene no conjunto público: `docs/review-camadas.md` sem nome de org privada, números de PR e ids de sessão; `docs/cursor-native-audit.md` e `docs/public-launch.md` sem referências a paths privados (`.cursor/plans/`, `.cursor/memory/`); denylist do sync ganha `\bWAM\b` e `\bSofia\b` (guard estrutural).

### Removido

- `docs/CONTRIBUTING.md`: seção **GitHub CLI (`gh`)** - troubleshooting de autenticação local (PAT fine-grained, keyring da máquina) não é guideline de contribuição; conteúdo já coberto em `.cursor/memory/errors/` e `autogit/gitupdate.md` (troubleshooting).

## [3.2.0] - 2026-07-17

### Adicionado

- Runbook genérico de migração consumer: `docs/migrate-consumer.md` (`YOUR_PROJECT`; manifest + `update` preserva L3; loop/orquestrado).
- Frota de consumers migrada (`f4-migrar-frota`): nested `agent-kit/` removido; manifests v3.0.0; L3 preservado (inventário anonimizado em `docs/drift-inventory.md`).
- CLI `agent-kit contribute`: detecta drift/novos artefatos, gate anti-slop/hygiene, `--write` para checkout local + corpo de PR sugerido (`docs/contribute-upstream.md`).
- Coerência interna (`f6`): skills SoT no registry (incl. `json-data-config`, `prompts-markdown`, `ux-message-flows`); merge `code-deslop` → `clean-code` e `clickup-project-mgmt` → `clickup`; workspace só via `agent-kit update`; inventário atualizado.
- Repo público (`f6`): README EN com tese HITL; `docs/public-launch.md` go/no-go; `sync-public.mjs` default **append-only** (`--force-snapshot` escape hatch).
- Topologia Fase 7 (`f7-topologia-repos`): `docs/topology-private-public.md` - Phase A mirror vs Phase B registry canônico no público; cutover e promote runbook; boundaries/CONTRIBUTING alinhados.
- Marketplace (`f7-marketplace`): skills com `version`/`category` no frontmatter; builder → `registry.json`; `docs/marketplace.md` + gate em CONTRIBUTING; plugin.json alinhado à tese HITL.
- MCP pago (`f7-mcp-pago`): spec Release 2 em doc privado (valor vs registry grátis, tiers, infra, gate de implementação).
- Review camadas (`review-camadas`): `docs/review-camadas.md` - pass HITL/gates; residuals só ops.
- Bootstrap sem cópia de pasta: `docs/bootstrap.md`; `install.md` / README / getting-started apontam para `agent-kit install` (L0 + `autogit/` + manifest); L0 passa a incluir `autogit/gitupdate.md` e `autogit/plan-routine.md`.
- CLI lifecycle: `agent-kit install` / `update` / `diff` (com `add`/`status` alinhados) contra registry local ou cache remoto; `update` e cópias respeitam paths L3 em `protected` / `overrides` do manifest.
- `docs/drift-inventory.md`: inventário de drift entre workspaces (cópias `agent-kit/`, contagens, candidatos L0, artefatos L3 e órfãos a promover).
- `docs/layers-spec.md`: spec das camadas L0–L3 (precedência, nomenclatura, lista L0, packs L1, limites L2/L3).
- Comando **`/executar-plano-loop`**: execução contínua do plano com update de status nos to-dos a cada tick, HANDOFF e `/git-staging` automático (nunca `/git-prod` no loop).
- Comando **`/executar-plano-orquestrado`**: janela principal magra + workers (Task); contrato de summary; staging automático; fallback para loop/manual se não houver subagentes; L0 no CLI (`packages/cli/src/lifecycle/l0.ts`).
- Template de plano **`.cursor/context/templates/plan.md`** com budget de contexto por to-do (`read_scope`, `worker_contract`, `max_ticks`); `autogit/plan-routine.md` e rule `cursor-plan-handoff` documentam os campos.
- Manifest de distribuição **`.cursor/agent-kit.json`**: schema JSON (`schemas/agent-kit.manifest.schema.json`), doc (`docs/agent-kit-manifest.md`), parser/tipos no CLI, dogfood neste repo; `agent-kit status` mostra manifest + profile.
- Domain packs L1 (`registry/packs/*/pack.json` + `docs/domain-packs.md`): membership dos 7 packs (`cybersec`, `devops`, `engenharia-arquitetura`, `clean-code`, `gestao-projeto`, `gestao-contexto`, `quality`); schema `schemas/agent-kit.pack.schema.json`.
- Registry **schemaVersion 2**: `registry/registry.json` passa a listar `packs` e `artifacts` (rules/agents/commands/hooks via packs); `node scripts/build-registry.mjs`; `agent-kit add` instala skill ou pack (`--skill`/`--pack` se id colidir).

### Alterado

- Hygiene: origem de sessão ≠ caso de uso do produto; dogfood canônico = este monorepo; docs de migrate/drift/bootstrap sem nomes de consumer; decisão `2026-07-17_session-origin-not-product-usecase`.
- `docs/drift-inventory.md` / `docs/bootstrap.md`: piloto = dogfood no SoT; migrate-consumer = runbook genérico.
- `agent-kit update` deixa de regenerar só pelo wizard profile: sincroniza L0/packs/skills a partir do manifest e do registry.
- `docs/getting-started.md`: tabela de comandos com `install` / `diff` / lifecycle L3.
- Decisão em `.cursor/memory/decisions/`: título e arquivo renomeados para *framework HITL (contra autonomia sem revisão)* - remove termo transitório do posicionamento do produto; índice e referência histórica no CHANGELOG alinhados.
- `docs/README.md`: links para inventário de drift e spec de camadas.
- `autogit/plan-routine.md` e rule `cursor-plan-handoff.mdc`: plano primeiro; três modos (manual / loop / orquestrado); placar de status no frontmatter.
- `docs/getting-started.md`, `docs/layers-spec.md`, `docs/coherence-inventory.md`: documentam o loop no core.

### Corrigido

- Sync público: spec de pricing (doc privado) excluída do manifest até decisão de publicação; links públicos ajustados.
- Segurança (CLI): registry remoto valida `url`/`ref` antes do `git clone` - só `https://`, rejeita transportes que executam comando (`ext::`, `file://`, `ssh`) e argument injection (`-...`); subprocessos git rodam com `GIT_ALLOW_PROTOCOL=https`. Fecha o vetor de RCE via `registry.url` em `.cursor/agent-kit.json` de projeto não confiável.
- Sync público: `sync-public.mjs` ganha guard de **conteúdo** além do allowlist de paths - bloqueia shapes de secret (AWS, PAT, private key, Slack) e termos de denylist privada (`scripts/public-sync.denylist`, fora do manifest público; override via `PUBLIC_SYNC_DENYLIST`).
- `docs/drift-inventory.md`: inventário totalmente anonimizado (workspaces → `consumer-N`, artefatos L3 → exemplos genéricos); nenhum nome de consumer privado no conjunto sincronizado ao público.
- CI: contexto `secrets` não é permitido em `if` de job - jobs `sync-public` e `publish-npm` agora condicionam só por ref/evento e os steps pulam com aviso quando `PUBLIC_REPO_URL` / `NPM_TOKEN` não estão configurados (o `workflow_dispatch` falhava com HTTP 422).
- `scripts/trigger-public-sync-after-prod.sh`: aceita remotes GitHub com alias SSH (ex.: `git@github-agent-kit:owner/repo.git`), não só URLs `github.com`.

---

## [3.1.0] - 2026-07-14

### Alterado

- **Staging-first:** `git staging` → `origin/staging` passa a ser o comando/branch canônico do spine DevOps; `git homolog` / `homologacao` viram sinônimos legados. Branch `staging` criada no origin a partir de `homologacao`. Atualizados: `autogit/gitupdate.md` (prompts "git staging" e "git prod" com fechamento de release no CHANGELOG e passo de sync público), `autogit/plan-routine.md`, rules (`cursor-skills-git-workflow`, `cursor-skills-general`, `cursor-skills-devops`, `cursor-skills-clickup`), commands (`git-staging` principal, `git-homolog` legado, `git-prod`), agents (`git-autogit`, `clickup-tasks`), skill core `git-workflow`, README, `install.md`, `cursor-handoff`, docs (`repository-boundaries`, `getting-started`, `cursor-3-features`, `coherence-inventory`) e CLI (detecção de branch `staging`, labels e textos de handoff; valor interno `homolog-prod` mantido por compatibilidade). Decisão registrada em `.cursor/memory/decisions/2026-07-14_staging-first-branch-rename.md`.

### Adicionado

- `docs/cursor-native-audit.md`: auditoria Cursor-native (plugin, rule modes, shell hooks, gaps `hooks.json`, VS Code/Windsurf).
- `docs/coherence-inventory.md`: inventário Fase 1 - classificação core | stack | merge de rules, skills, hooks, agents e commands.

### Alterado

- `.cursor/rules/ux-tone.mdc`: frontmatter YAML (`alwaysApply: true`) para carregamento consistente no Cursor.
- `docs/README.md`: links para cursor-native audit e coherence inventory.
- **Identidade do projeto atualizada**: nova descrição unificada - "Developer bootstrapper for AI-assisted IDEs" - propagada para README, `package.json` (root + CLI), `plugin.json`, `docs/github-about.md`, CLI meta, e todas as docs (`getting-started`, `creating-skills`, `cursor-3-features`, `CONTRIBUTING`, `repository-boundaries`, `templates/*/README`). README reestruturado: "Why v3" substituído por "What it does" (understand → generate → maintain context) e "Key features".

### Corrigido

- `packages/cli/src/utils/logger.ts`: import nomeado de `kolorist` (ESM sem `default`) para compatibilidade com Node 20+ ao executar a CLI.

### Adicionado

- `scripts/trigger-public-sync-after-prod.sh` e script npm `pnpm git:trigger-public-sync`: após `git prod`, disparam `workflow_dispatch` do CI no `origin` (`sync_public=true`, ref `main`) quando existe remote `public` no GitHub; integrado ao passo 13 de `autogit/gitupdate.md`, `.cursor/commands/git-prod.md`, regra `cursor-skills-git-workflow.mdc` e agente `git-autogit.md`. Arquivo incluído no `public-sync.manifest`.
- `docs/repository-boundaries.md`: English doc - local × Git × npm table; CI blocks tracking `HANDOFF.md` and `*.plan.md` under `.cursor/plans/`; private vs public mirror and sync manifest (see file for current setup).
- Passo **Guard public tree** em `.github/workflows/ci.yml`.
- `scripts/sync-public.mjs` e `scripts/public-sync.manifest`: sync por allowlist para repositório público espelho.
- Jobs CI **sync-public** (tag `v*` ou `workflow_dispatch`) e **publish-npm** (tag `v*`), ativos apenas quando os secrets `PUBLIC_REPO_URL` e `NPM_TOKEN` estiverem configurados.
- `docs/github-about.md`: texto de About para o repositório GitHub (description + topics).
- Core skills (5) incluídos em `registry/registry.json` (antes só tinha community).
- `init` e `update`: quando `registry/registry.json` existe no projeto, instalam automaticamente as skills core selecionadas no profile em `.cursor/skills/` (`installSkillsByIds` em `registry/install.ts`).
- Regra `.cursor/rules/memory-loop.mdc`, layout `.cursor/memory/` (`errors/`, `decisions/`, `_index.md`) e subagente `memory-extractor` para consolidar aprendizados entre sessões.
- **`agent-kit handoff`:** lê plano ativo em `.cursor/plans/`, grava `.cursor/HANDOFF.md` com progresso, to-dos e rotinas sugeridas; se existir `.cursor/agent-kit.config.json`, usa workflow Git e ferramentas de gestão de projeto do perfil (senão sugere PR/MR genérico).
- Scanner CLI: metadados por provedor Git (`GIT_PLATFORM_META`), tipos de CI e de ferramenta de gestão de projeto ampliados para geradores e docs.
- Rules **`agent-output-hygiene.mdc`** (chat ≠ artefato versionado) e **`docs-professional-standard.mdc`** (documentação herdável, sem contexto transitório).
- Comando **`/git-staging`** (alias de `git homolog`) em `.cursor/commands/git-staging.md`.
- Decisões em `.cursor/memory/decisions/`: framework HITL (contra autonomia sem revisão), harness estrutural vs stack, output hygiene, docs professional standard.
- `adicionar-skills.md`, `install.md`, `categories.md`, `registry-schema.md`, `skills-registry.json`, scripts `build-registry.sh` e `new-skill.sh`, `HANDOFF.md.example`.

### Alterado

- **Public Harness F0:** tese de framework (autonomia + humano no loop); spine DevOps (`git staging` ≡ `git homolog` → `git prod` → memory-loop); PM (ClickUp) e n8n **on demand**, não core.
- `autogit/gitupdate.md`, `autogit/plan-routine.md`: rotinas alinhadas ao spine DevOps e sinônimos staging/homolog.
- Agents, rules, skills (`.cursor/` + `registry/skills/core/`) e commands revisados para hygiene, docs standard e HITL.
- `cursor-handoff`, README e `docs/cursor-3-features.md` alinhados à narrativa de harness estrutural.

### Alterado

- `docs/repository-boundaries.md`: fluxo homolog → prod → **`pnpm git:trigger-public-sync`** (além de tag/dispatch manual). `autogit/gitupdate.md`: passo 13 detalhado; resumo em `git prod` (What it does).
- `.gitignore`: ignorar `.cursor/plans/**/*.plan.md` (inclui `archive/`); snapshots de plano arquivado deixam de ser candidatos a commit.
- `autogit/gitupdate.md`: seção sobre nomenclatura `main` / `homologacao`, ambientes de CI vs branches e boas práticas GitHub/GitLab.
- `.cursor/memory/`: índice único (errors + decisions) e decisão registrada sobre branches e ambientes.
- **Narrativa de handoff unificada:** handoff em arquivo é a fonte da verdade; features nativas do Cursor (summaries, `/resume`, Agents Window) complementam - não substituem.
- `context-guardian.mdc`: planejar por ~50% da janela, gravar HANDOFF após cada task, aviso proativo em ~60%.
- `cursor-plan-handoff.mdc`: um HANDOFF por projeto, atualizar to-dos sempre, sugerir rotinas pós-task; CLI + script `./cursor-handoff` opcional documentados.
- `.cursor/commands/handoff.md`, `context-librarian.md`: fluxo completo e rotinas pós-task.
- `docs/cursor-3-features.md`: Cursor nativo como complemento, não substituto.
- `generator/cursor.ts`: rules geradas incluem handoff awareness (regra `03-handoff.mdc`).
- README, `docs/github-about.md`, `docs/creating-skills.md`: lista completa de comandos CLI; esclarecimento core skills vs `registry/`; `add` descrito como core + community.
- `agent-kit add`: descrição do comando (core ou community).
- `agent-kit handoff`: plano ativo → HANDOFF.md; `./cursor-handoff handoff` opcional quando o script existe na raiz (Unix; Windows orientar Git Bash/WSL).
- `docs/CONTRIBUTING.md`: seção **GitHub CLI (`gh`)** - PAT fine-grained vs `checks:read`, OAuth no navegador ou PAT classic com `repo`.
- `CHANGELOG.md` reformatado para [Keep a Changelog](https://keepachangelog.com/) com seções PT-BR, `[Unreleased]` e links de comparação.
- `registry/registry.json`: estrutura separada em `{ core, community }` em vez de array flat.
- `registry/client.ts`: nova função `allSkills()` que busca em core + community.
- `registry/install.ts`: detecta core vs community + `installSkillsByIds` para instalação em lote.
- `registry/types.ts`: `RegistryIndex.skills` agora é `{ core, community }`.

### Removido

- Dependência `zod` do CLI (não era utilizada em nenhum arquivo).

### Corrigido

- CI (GitHub Actions): `pnpm/action-setup@v4` não recebe mais `version` duplicada; usa `packageManager` do `package.json` (`pnpm@10.0.0`).

---

## [3.0.0] - 2026-04-05

### Adicionado

- Monorepo com `pnpm` + `turbo` e CLI em TypeScript (`packages/cli`).
- Scanner de projeto (`agent-kit scan`): detecta stack, IDE, estrutura existente.
- Wizard dual-path: setup guiado para repos existentes e greenfield.
- Gerador adaptativo: gera regras, skills e templates conforme IDE e plano/tier.
- Registry installer (`agent-kit add <skill>`): instala skills do catálogo core/community.
- Estrutura `registry/` (core + community) e `templates/` por IDE.
- `autogit/gitupdate.md`: rotinas `git homolog` / `git prod` com Conventional Commits, SemVer e CHANGELOG.
- `autogit/plan-routine.md`: roteiro de criação de planos com ClickUp sync.
- `git-hooks/prepare-commit-msg`: remove `Co-authored-by: Cursor` dos commits.
- `.cursor/commands/`: git-homolog, git-prod, handoff, continuar-plano, iniciar-projeto, context-status, dicas, resumo.
- `.cursor/agents/`: 12 subagentes (git-autogit, cleancode-refactor, context-librarian, docs-repo, json-guardian, n8n-workflows, prompts-agents, security-reviewer, sql-schema, tech-lead, testes-roteiros, clickup-tasks).
- `.cursor/rules/`: regras always-on (general, git-workflow, clickup, plan-handoff, context-guardian, ux-tone).
- CI via GitHub Actions (lint, test, build).
- Documentação: getting-started, creating-skills, cursor-3-features, CONTRIBUTING.

### Alterado

- Migração completa de v2 (shell script + JSON registry) para v3 (TypeScript monorepo).
- v2 preservada em `_legacy/v2/` para referência.

---

[Unreleased]: https://github.com/agent-kit-startup/agent-kit/compare/v3.5.1...HEAD
[3.5.1]: https://github.com/agent-kit-startup/agent-kit/compare/v3.5.0...v3.5.1
[3.5.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.4.0...v3.5.0
[3.4.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.3.1...v3.4.0
[3.3.1]: https://github.com/agent-kit-startup/agent-kit/compare/v3.3.0...v3.3.1
[3.3.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/agent-kit-startup/agent-kit/releases/tag/v3.0.0
