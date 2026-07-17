# Agent Kit — Instalação

> **Você é o instalador.** Siga os passos abaixo para montar a estrutura do Agent Kit.

## Instruções para o Agente

Ao receber este documento (arrastado para o chat ou via @install.md):

### 1. Verificar/Criar Estrutura

Garantir que existem os seguintes diretórios e arquivos:

```
.cursor/
├── docs/
│   └── n8n-mcp-cursor-setup.md   (opcional; para setup n8n-MCP no Cursor)
├── mcp.json                       (opcional; configuração MCP, ex. n8n-mcp)
├── rules/
│   ├── cursor-plan-handoff.mdc
│   ├── context-guardian.mdc
│   ├── ux-tone.mdc
│   ├── cursor-skills-general.mdc
│   ├── cursor-skills-git-workflow.mdc
│   ├── cursor-skills-clickup.mdc
│   ├── cursor-skills-n8n.mdc
│   ├── cursor-skills-json.mdc
│   ├── cursor-skills-sql.mdc
│   ├── cursor-skills-prompts.mdc
│   ├── cursor-skills-node.mdc
│   ├── cursor-skills-api.mdc
│   ├── cursor-skills-integrations.mdc
│   ├── cursor-skills-devops.mdc
│   ├── cursor-skills-testing.mdc
│   ├── cursor-skills-webdesign.mdc
│   ├── cursor-skills-mobile.mdc
│   ├── cursor-skills-php.mdc
│   ├── cursor-skills-groovy.mdc
│   └── cursor-skills-python.mdc
├── skills/
│   ├── ux-message-flows/
│   │   └── SKILL.md
│   ├── n8n-workflows/
│   │   └── SKILL.md
│   ├── json-data-config/
│   │   └── SKILL.md
│   ├── sql-postgres/
│   │   └── SKILL.md
│   ├── prompts-markdown/
│   │   └── SKILL.md
│   ├── clickup-project-mgmt/
│   │   └── SKILL.md
│   └── code-deslop/
│       └── SKILL.md
├── agents/
│   ├── n8n-workflows.md
│   ├── git-autogit.md
│   ├── prompts-agents.md
│   ├── sql-schema.md
│   ├── testes-roteiros.md
│   ├── docs-repo.md
│   ├── json-guardian.md
│   ├── clickup-tasks.md
│   ├── security-reviewer.md
│   ├── cleancode-refactor.md
│   ├── tech-lead.md
│   └── context-librarian.md
├── hooks/
│   ├── lib/
│   │   ├── json-validator.js
│   │   └── n8n-checker.js
│   ├── pre-edit/
│   │   └── validate-json.sh
│   ├── post-edit/
│   │   └── validate-n8n.sh
│   ├── pre-commit/
│   │   ├── pre-commit
│   │   ├── check-secrets.sh
│   │   └── validate-all-json.sh
│   ├── on-task-start/
│   └── on-task-end/
├── plans/
├── context/
│   ├── templates/
│   │   ├── context-pack.md
│   │   ├── handoff.md
│   │   ├── task-brief.md
│   │   ├── adr.md
│   │   └── checklist-n8n.md
│   ├── current/
│   ├── archive/
│   ├── backups/
│   └── decisions/
└── commands/
    ├── handoff.md
    ├── continuar-plano.md
    ├── context-status.md
    ├── resumo.md
    ├── iniciar-projeto.md
    ├── git-homolog.md
    └── git-prod.md
```

Na raiz do workspace (ou ao lado de `.cursor/` quando o kit está em subpasta):

```
autogit/
├── gitupdate.md
└── plan-routine.md
```

### 2. Criar HANDOFF.md (se não existir)

Se **não existir** `.cursor/HANDOFF.md`:
- Copiar conteúdo de `HANDOFF.md.example` para `.cursor/HANDOFF.md`
- Ou usar o template em `.cursor/context/templates/handoff.md`

### 3. Verificar cursor-handoff CLI

Garantir que o arquivo `cursor-handoff` na raiz:
- Existe
- Está executável (`chmod +x cursor-handoff`)

### 4. Hooks e dependências

- **Node.js:** necessário para os validadores (`.cursor/hooks/lib/json-validator.js`, `n8n-checker.js`). Se não estiver instalado, avisar o usuário.
- **Pre-commit hook (opcional):** para validar JSON e detectar secrets antes de cada commit:
  ```bash
  cp .cursor/hooks/pre-commit/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
  ```
  O hook chama os scripts em `.cursor/hooks/pre-commit/`; não é necessário copiar check-secrets.sh e validate-all-json.sh para .git/hooks.
- **Prepare-commit-msg (opcional):** remove o trailer `Co-authored-by: Cursor <cursoragent@cursor.com>` que o Cursor adiciona às mensagens de commit. O `cursor-handoff install` copia `agent-kit/git-hooks/prepare-commit-msg` para `.git/hooks/prepare-commit-msg` quando o workspace é um repositório Git. Manualmente:
  ```bash
  cp agent-kit/git-hooks/prepare-commit-msg .git/hooks/prepare-commit-msg && chmod +x .git/hooks/prepare-commit-msg
  ```

### 5. Detectar Primeira Instalação e Fazer Onboarding

Se **não existia** `.cursor/HANDOFF.md` antes (primeira instalação):

1. **Boas-vindas:**
   > "E aí! Bem-vindo ao **Agent Kit**. Aqui você não perde mais o contexto quando a conversa fica longa."

2. **Explicação rápida:**
   > "Funciona assim: quando o contexto encher, a gente salva o estado e você continua numa nova conversa. Você tem skills (n8n, JSON, SQL, prompts, UX), regras por tipo de arquivo, subagentes e hooks de validação. Comandos: `/iniciar-projeto`, `/handoff`, `/continuar-plano`, `/git-homolog`, `/git-prod`."

3. **Próximo passo:**
   > "Bora criar seu primeiro plano? (sim/não)"
   - Se **sim:** guiar para criar plano com to-dos (usar `/iniciar-projeto`)
   - Se **não:** "Show! Estrutura pronta. Quando quiser começar, manda `/iniciar-projeto`."

### 6. MCP (opcional)

Para projetos n8n: o workspace pode incluir `.cursor/mcp.json` (ex.: servidor [n8n-MCP](https://github.com/czlonkowski/n8n-mcp)) e `.cursor/docs/n8n-mcp-cursor-setup.md`. O instalador não cria esses arquivos por padrão; podem ser adicionados manualmente ou pelo usuário conforme [Cursor Setup n8n-MCP](https://github.com/czlonkowski/n8n-mcp/blob/main/docs/CURSOR_SETUP.md).

### 7. Confirmar Instalação

Se **não for** primeira instalação (`.cursor/HANDOFF.md` já existia):

> "Estrutura verificada! Tudo certo. Comandos disponíveis:"
> - `/iniciar-projeto` — começar ou retomar projeto
> - `/handoff` — salvar estado para continuar depois
> - `/continuar-plano` — retomar de onde parou
> - `/context-status` — ver estado atual
> - `/resumo` — resumo rápido
> - `/git-homolog` — levar alterações para homologação
> - `/git-prod` — promover homologação para produção

---

## Estrutura do Agent Kit

- **Rules:** Regras para o agente (handoff, contexto, tom de voz, Git, n8n, JSON, SQL, Node, API, integrações, DevOps, testes, web, mobile, PHP, Groovy, Python).
- **Skills:** n8n-workflows, json-data-config, sql-postgres, prompts-markdown, ux-message-flows.
- **Agents:** Subagentes para n8n, Git, prompts, SQL, testes, docs, JSON, segurança, refatoração, tech lead, contexto.
- **Hooks:** Validação JSON e n8n (lib + pre-edit/post-edit); pre-commit (check-secrets + validate-all-json).
- **git-hooks:** prepare-commit-msg (remove Co-authored-by Cursor dos commits); instalado em `.git/hooks/` pelo `cursor-handoff install`.
- **Templates:** Context Pack, Handoff, Task Brief, ADR, checklist-n8n.
- **Commands:** handoff, continuar-plano, context-status, resumo, iniciar-projeto, git-homolog, git-prod.
- **autogit:** `autogit/gitupdate.md` — guia detalhado para os comandos `/git-homolog` e `/git-prod` (prompts técnicos para AI; compatível com GitLab ou GitHub).
- **cursor-handoff:** CLI para gerenciar contexto via terminal.
