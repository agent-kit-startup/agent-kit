# Agent Kit

**Framework for AI-assisted development on long-running projects** — human-in-the-loop by design, for any AI-assisted IDE.

Agent Kit gives coding agents a structural harness: plans with trackable to-dos, context handoff between sessions, a persistent memory loop, and a staged git workflow with explicit human confirmation before anything reaches production.

## Principles

- **Human-in-the-loop.** Agents automate inside the fence; humans approve at the gates. Production promotion (`/git-prod`) always requires explicit confirmation.
- **Structure over improvisation.** Plan → handoff → staging → prod. Long conversations hand off state instead of losing it.
- **Output hygiene.** Chat stays in chat: commits, docs, and memory carry technical facts only — no agent metalanguage, no session narrative.
- **Structural core, opt-in stack.** The Core Pack covers handoff, memory loop, hygiene, docs standards, and the git workflow. Stack tooling (ClickUp, n8n, SQL, …) is installed on demand via `agent-kit add` — never as always-on rules.

**Install** (without nesting this repo): `npx @agent-kit/cli install` — see [docs/bootstrap.md](docs/bootstrap.md). **Contribute upstream:** `agent-kit contribute` — [docs/contribute-upstream.md](docs/contribute-upstream.md).

---

## Descrição (PT)

Kit de handoff e memória de contexto entre agentes no Cursor. Quando a conversa fica longa demais, você não perde o trabalho — o agente salva o estado e você continua numa nova conversa. Inclui skills, rules, subagentes, hooks e commands; stack (n8n, JSON, SQL, …) só sob demanda.

## Objetivo

- Não perder contexto: conversas longas esgotam a janela de contexto; com o Agent Kit você salva o estado e continua depois.
- Planos com to-dos trackáveis, ambiente completo (skills, rules, hooks, fluxo Git) e onboarding fácil.
- HITL: staging automático no loop; **produção só com confirmação explícita**.

## Como funciona

1. **Você trabalha normalmente** no Cursor com o agente.
2. **Contexto enchendo?** O agente avisa e sugere fazer handoff.
3. **Handoff:** O agente salva o estado em `.cursor/HANDOFF.md`.
4. **Nova conversa:** Você abre nova conversa e manda `/continuar-plano`.
5. **O agente lê o handoff** e retoma de onde parou.

O aviso de "contexto enchendo" (passo 2) é **heurístico**: o Cursor não expõe uso exato de tokens, então o agente se baseia no tamanho aparente da conversa (ex.: muitas mensagens ou trocas longas) para sugerir handoff. Avisar cedo é melhor que tarde.

## Estrutura

Este repositório é o **SoT / registry** do Agent Kit (monorepo). Em **projetos consumidores**, o kit **não** vive como pasta `agent-kit/` aninhada — só `.cursor/` + `autogit/` + manifest. Contrato: [docs/bootstrap.md](docs/bootstrap.md).

### Este monorepo (desenvolvimento do kit)

| Conteúdo | Uso |
|----------|-----|
| `.cursor/` | SoT de rules, commands, hooks L0 e workspace dogfood |
| `packages/cli` | `@agent-kit/cli` — `install` / `add` / `update` / `diff` / `status` |
| `registry/` | Packs L1, skills L2, índice |
| `autogit/`, `git-hooks/` | Spine Git e hook prepare-commit-msg |
| `install.md` | Porta B: agente instala no projeto sem copiar o monorepo |
| `docs/` | Layers, manifest, bootstrap, drift |

### Instalar noutro projeto (consumidor)

**Não** copie este repositório para dentro do projeto. Na raiz do projeto:

```bash
npx @agent-kit/cli install
# packs opcionais:
npx @agent-kit/cli install --pack clean-code,gestao-contexto
```

Ou abra o projeto no Cursor, arraste `install.md` (deste repo ou do espelho público) e peça para instalar — o agente segue o mesmo contrato (L0 + manifest + `autogit/`).

Lifecycle: `agent-kit add` · `update` · `diff` · `status`. Detalhes: [docs/getting-started.md](docs/getting-started.md).

## Setup / Uso

### Pré-requisitos

- [Cursor](https://cursor.com) (ou outra IDE suportada)
- **Node.js** para a CLI e hooks que precisam de runtime

### Passos (projeto consumidor)

1. Na raiz do projeto: `npx @agent-kit/cli install` (ou `@install.md` no chat).
2. Confirme `.cursor/agent-kit.json` e `autogit/gitupdate.md`.
3. Opcional — prepare-commit-msg (um arquivo, não a árvore do kit):
   ```bash
   # Fonte no registry/SoT: git-hooks/prepare-commit-msg
   cp /path/to/kit-checkout/git-hooks/prepare-commit-msg .git/hooks/prepare-commit-msg && chmod +x .git/hooks/prepare-commit-msg
   ```
4. Pronto: `/iniciar-projeto` no chat.

Se o projeto ainda tiver uma pasta `agent-kit/` aninhada (legado): migre L3, rode `install`, apague a cópia — [docs/bootstrap.md](docs/bootstrap.md).

## O que é instalado

### MCP e skills de stack (opcional — não são o harness)

O Core Pack é **estrutural** (handoff, git staging→prod, memory, hygiene, docs). Ferramentas de produto entram **só se o projeto exigir**:

| Tipo | Exemplos | Quando |
|------|----------|--------|
| Gerenciador de projetos | ClickUp, Jira, Linear, … | Se o time já usa e há MCP/skill |
| Automação | n8n, … | Se o repo contém workflows dessa stack |
| Dados / API | Postgres, JSON, … | Se o código do projeto usa |

Não instalar ClickUp ou n8n “porque veio no kit”. Detectar ou perguntar no wizard; community registry via `agent-kit add` / skill sob demanda.

Convenções de uma PM tool específica (títulos, status) vivem na skill dessa tool — nunca como rule `alwaysApply` do core.

### Skills (`.cursor/skills/`)

Skills de **stack** (n8n, ClickUp, SQL, …) são opcionais e sob demanda. O install mínimo não as exige. Categorias em [categories.md](categories.md).

### Gerador de skill e como adicionar skills

Guia completo: [adicionar-skills.md](adicionar-skills.md). No **monorepo do kit** (não no projeto consumidor):

```bash
scripts/new-skill.sh <skill-slug> [categoria]
```

No projeto consumidor: `agent-kit add <skill-id>` contra o registry.

### Registry de skills

O registry versionado vive em `registry/` neste monorepo (e no espelho público). Consumidores usam `agent-kit add` / `install` — não `agent-kit/skills-registry.json` aninhado.

No monorepo: `node scripts/build-registry.mjs` (ou scripts legados documentados em [registry-schema.md](registry-schema.md)).

### Rules (`.cursor/rules/`)

- **Handoff e contexto:** cursor-plan-handoff, context-guardian, ux-tone
- **Gerais e Git:** cursor-skills-general, cursor-skills-git-workflow
- **ClickUp:** cursor-skills-clickup (convenções de tasks, status, integração com git staging/prod)
- **Por tecnologia:** cursor-skills-n8n, cursor-skills-json, cursor-skills-sql, cursor-skills-prompts, cursor-skills-node, cursor-skills-api, cursor-skills-integrations, cursor-skills-devops, cursor-skills-testing, cursor-skills-webdesign, cursor-skills-mobile, cursor-skills-php, cursor-skills-groovy, cursor-skills-python

### Subagentes (`.cursor/agents/`)

| Subagente | Uso |
|-----------|-----|
| n8n-workflows | Editar e documentar workflows n8n |
| git-autogit | Fluxo staging → produção (git staging, git prod) |
| clickup-tasks | Criar/atualizar tasks no ClickUp (convenções, status, descrições) |
| prompts-agents | Criar e editar prompts de agentes |
| sql-schema | DDL, migrations, índices Postgres |
| testes-roteiros | Roteiros de testes, checklist, relatórios |
| docs-repo | README, ADRs, runbooks, guias |
| json-guardian | Validação e normalização de JSON |
| security-reviewer | Revisão de segurança (auth, PII, secrets) |
| cleancode-refactor | Refatoração e boas práticas |
| tech-lead | Decisões de tecnologia, ADRs |
| context-librarian | Atualizar Context Pack e handoff |

### Hooks (`.cursor/hooks/` e `git-hooks/`)

| Hook | Descrição |
|------|-----------|
| pre-commit/check-secrets.sh | Detecta secrets em arquivos staged (L0) |
| lib/json-validator.js | Valida sintaxe JSON (stack / opcional) |
| lib/n8n-checker.js | Valida workflows n8n (stack / opcional) |
| **git-hooks/prepare-commit-msg** | Remove `Co-authored-by: Cursor` (copiar só o arquivo para `.git/hooks/`) |

### Commands (`.cursor/commands/`)

| Comando | O que faz |
|---------|-----------|
| /iniciar-projeto | Começar um novo projeto ou retomar existente |
| /handoff | Salvar estado para continuar depois |
| /continuar-plano | Retomar de onde parou (em nova conversa) |
| /executar-plano-loop | Loop contínuo na mesma sessão (staging por tick; nunca prod) |
| /executar-plano-orquestrado | Orquestrador magro + workers Task (fallback: loop/manual) |
| /context-status | Ver estado atual (tarefa ativa, arquivados) |
| /resumo | Resumo rápido do que foi feito e o que falta |
| /git-staging | Levar alterações para `origin/staging` (legado: /git-homolog) |
| /git-prod | Promover staging para `origin/main` |

### Templates (`.cursor/context/templates/`)

- context-pack.md, handoff.md, task-brief.md, plan.md, adr.md, checklist-n8n.md

### Autogit (`autogit/`)

O install coloca **`autogit/gitupdate.md`** e **`autogit/plan-routine.md`** na raiz do **projeto consumidor** (L0). Guia de `/git-staging` e `/git-prod`, e modos de plano (manual / loop / orquestrado). Sem pasta `agent-kit/` aninhada.

## Git (staging → produção)

Se o projeto usar fluxo **staging antes de main**:

- **Nunca** fazer commit direto em `main`. Sempre promover via staging.
- **git staging:** desenvolvimento → `origin/staging` (branch de trabalho, commit, MR/PR, merge). Use o comando `/git-staging` no chat; o agente segue a rotina em `autogit/gitupdate.md` (incluído no kit). Em repositórios legados o sinônimo `git homolog` continua aceito.
- **git prod:** staging aprovada → `origin/main` (merge staging → main, push). Use `/git-prod` no chat; o agente segue a rotina em `autogit/gitupdate.md`.
- Mensagens: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- **ClickUp (opcional):** Com o MCP do ClickUp configurado, o agente pode atualizar o status das tarefas/subtarefas relacionadas ao final de `git staging` e `git prod`. Não é obrigatório; sem o MCP, a rotina segue normalmente.

## CLI

```bash
# Bootstrap L0 + manifest no projeto atual
npx @agent-kit/cli install
npx @agent-kit/cli add <pack-or-skill>
npx @agent-kit/cli update
npx @agent-kit/cli diff
npx @agent-kit/cli status

# Context handoff (CLI legado neste monorepo, opcional)
./cursor-handoff new minha-tarefa
./cursor-handoff status
./cursor-handoff handoff
```

## Arquivos principais

| Item | Descrição |
|------|-----------|
| install.md | Porta B — instalação via chat (sem copiar monorepo) |
| docs/bootstrap.md | Contrato de bootstrap mínimo |
| packages/cli | `@agent-kit/cli` lifecycle |
| git-hooks/prepare-commit-msg | Hook opcional (arquivo único) |
| HANDOFF.md.example | Exemplo de handoff |

O restante (rules L0, packs, skills) vem do **registry** via CLI — não de uma cópia da pasta do kit.

## Notas

- **Segurança:** O pacote não contém dados de projetos reais. HANDOFF.md e Context Packs são locais. Adicione `.cursor/HANDOFF.md` ao `.gitignore` se não quiser versionar. Hooks pre-commit ajudam a evitar commit de secrets.
- **Dicas:** Use planos com to-dos; faça handoff cedo; use `/resumo` se ficar perdido; skills de stack só com `agent-kit add`.
