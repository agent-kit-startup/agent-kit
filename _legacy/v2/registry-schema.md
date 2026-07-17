# Formato do registry de skills — Agent Kit

Usado para listagem e instalação sob demanda. O registry é um JSON gerado a partir do filesystem (script `scripts/build-registry.sh`).

## Convenção de pastas

- Skills ficam em `.cursor/skills/<path>/SKILL.md`.
- Cada skill tem frontmatter YAML com: `name`, `description` e opcionalmente `category`.
- O campo `path` no registry é o nome do diretório do skill (ex.: `n8n-workflows`).

## Schema do JSON

| Campo raiz | Tipo | Descrição |
|------------|------|-----------|
| `version` | string | Versão do formato (ex.: "1") |
| `categories` | string[] | Lista de categorias encontradas nos skills (ex.: integrações, dados, docs) |
| `skills` | object[] | Lista de skills |

Cada item em `skills`:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | string | Identificador do skill (frontmatter `name`) |
| `description` | string | Descrição curta (frontmatter `description`) |
| `category` | string | Categoria (frontmatter `category` ou "") |
| `path` | string | Nome do diretório (ex.: n8n-workflows) |

## Exemplo

```json
{
  "version": "1",
  "categories": ["integrações", "dados", "docs", "quality"],
  "skills": [
    {
      "name": "n8n-workflows",
      "description": "Cria, edita e documenta workflows n8n...",
      "category": "integrações",
      "path": "n8n-workflows"
    },
    {
      "name": "json-data-config",
      "description": "Valida, formata e manipula JSON...",
      "category": "dados",
      "path": "json-data-config"
    }
  ]
}
```

## Uso

- **Geração:** rodar `agent-kit/scripts/build-registry.sh` a partir da raiz do projeto (onde está `.cursor/skills/`); saída em `agent-kit/skills-registry.json` ou stdout.
- **Install:** se o registry existir, o `cursor-handoff install` pode usar a lista para copiar skills (perfil completo ou por categoria/nome); sem registry, mantém comportamento atual (conjunto fixo).
