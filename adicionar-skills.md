# Como adicionar e instalar skills - Agent Kit

Este guia explica como **criar** novos skills no seu workspace e como **instalar** skills (do kit ou por categoria/nome) usando o registry.

---

## 1. Criar um skill novo (gerador)

O script `scripts/new-skill.sh` gera a pasta e o `SKILL.md` com template padronizado.

**Uso:**

```bash
# Na raiz do projeto (onde está .cursor/ ou onde está o agent-kit)
agent-kit/scripts/new-skill.sh <skill-slug> [categoria]

# Exemplos
agent-kit/scripts/new-skill.sh excel-reports dados
agent-kit/scripts/new-skill.sh slack-bot integrações
```

**Categorias válidas:** `integrações`, `dados`, `docs`, `devops`, `quality`, `creation` (ver [categories.md](categories.md)).

O gerador cria `.cursor/skills/<skill-slug>/SKILL.md` com:

- Frontmatter: `name`, `description`, opcionalmente `category`
- Seções: **Quando usar**, **Processo / Instruções**, **Convenções e boas práticas**, **Exemplos**, **Notas**
- Uma decision tree sugerida (skill vs subagent) e espaço para checklist

**Boas descrições:** ação + contexto + critérios. Ex.: *"Valida e formata JSON de configs e payloads; use quando o usuário editar .json ou mencionar schema."* Evite descrições vagas como "Ajuda com código".

Depois de criar, edite o arquivo para preencher as seções e, se quiser que o skill apareça no registry, rode o script de build do registry (abaixo).

---

## 2. Registry e instalação por categoria ou nome

O **registry** (`skills-registry.json`) é um índice dos skills disponíveis, gerado a partir dos arquivos em `.cursor/skills/`. Ele é usado para listar e para instalar apenas o que você precisa.

### Gerar ou atualizar o registry

Na raiz do projeto (onde está `.cursor/skills/`):

```bash
agent-kit/scripts/build-registry.sh .cursor/skills agent-kit/skills-registry.json
```

Formato do registry: [registry-schema.md](registry-schema.md).

### Listar skills

```bash
agent-kit list              # all, grouped by category
agent-kit list data         # only from "data" category  
agent-kit list integrations
```

### Instalar com perfil

Ao instalar o Agent Kit no workspace você escolhe o perfil:

| Perfil    | O que instala |
|-----------|----------------|
| `completo` | Tudo (rules, skills, agents, hooks, commands, templates, autogit) - padrão |
| `minimo`   | Só handoff, context e git (sem rules, skills, agents) |
| `custom`   | Perguntas: instalar por **categoria** ou por **nome** de skill |

Exemplo:

```bash
agent-kit install custom
```

Se o registry existir, o install `custom` usa a lista de categorias e de skills para você escolher o que copiar para `.cursor/`. Sem registry, o install mantém o comportamento de copiar o conjunto fixo do kit.

---

## 3. Estrutura recomendada de um SKILL.md

- **Frontmatter:** `name` (identificador), `description` (uma linha; acionável), `category` (opcional; uma das listadas em [categories.md](categories.md)).
- **Quando usar:** cenários em que o agente deve aplicar a skill; decision tree skill vs subagent ajuda a não usar skill para fluxos complexos demais.
- **Processo:** passos específicos e acionáveis.
- **Convenções:** padrões do projeto ou da stack (ex.: nomes, formatos, onde colocar arquivos).
- **Exemplos:** trechos ou casos reais (opcional).
- **Notas:** limites, dependências, links (opcional).

Manter o SKILL.md focado e menor que ~500 linhas; detalhes muito longos podem ir em arquivos em subpasta (ex.: `references/`) e a skill instruir o agente a carregá-los quando necessário.

---

## 4. Resumo

| Ação | Comando ou arquivo |
|------|--------------------|
| Criar skill novo | `agent-kit/scripts/new-skill.sh <slug> [categoria]` |
| Atualizar registry | `agent-kit/scripts/build-registry.sh .cursor/skills agent-kit/skills-registry.json` |
| Listar skills | `agent-kit list [category]` |
| Instalar (perfil) | `agent-kit install [complete\|minimal\|custom]` |
| Categorias | [categories.md](categories.md) |
| Formato do registry | [registry-schema.md](registry-schema.md) |
