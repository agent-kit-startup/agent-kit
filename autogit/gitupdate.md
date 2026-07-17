# Autogit - Rotinas Git Automatizadas

Sistema automatizado para gerenciar o fluxo de desenvolvimento, staging e produção usando comandos simplificados. Compatível com GitLab ou GitHub (use `glab` ou `gh` conforme seu provedor).

No **Agent Kit**, autogit é o **spine DevOps**: estrutura a memória operacional dos agentes junto com planos, `/handoff` e memory-loop.

```
plano → /handoff → git staging → git prod → memory
```

## 📋 Comandos Disponíveis

| Comando | Alias / slash | Destino (neste repo) | Descrição |
|---------|---------------|----------------------|-----------|
| `git staging` | `/git-staging` (legado: `git homolog`) | `origin/staging` | Atualiza a branch de staging com as alterações locais |
| `git prod` | `/git-prod` | `origin/main` | Promove `origin/staging` → `origin/main` (produção) após aprovação |

Em projetos legados a branch de pré-prod pode chamar-se `homologacao`, `develop`, etc. O padrão de **dois degraus** é fixo; o nome canônico no Agent Kit é **`staging`**.

## 🔄 Fluxo de Trabalho

```
Desenvolvimento local 
    ↓
origin/staging (via `git staging`)
    ↓
origin/main - PRODUÇÃO (via `git prod`)
```

Após staging ou prod: atualizar `.cursor/HANDOFF.md`. Se o promote fechou incidente ou decisão com tradeoff, gravar em `.cursor/memory/` (memory-loop).

## 🚀 Como Usar

### 1. `git staging` - Desenvolvimento → Staging

Atualiza a branch `origin/staging` com as alterações locais.

**O que faz:**
- ✅ Valida segurança (bloqueia commits diretos em `main`)
- ✅ Verifica e atualiza `CHANGELOG.md` se necessário (bullets só em `[Unreleased]`)
- ✅ Sincroniza com `origin/staging`
- ✅ Cria branch de trabalho (`update/<escopo>` ou `feature/<nome>`)
- ✅ Faz commit com mensagem semântica (Conventional Commits)
- ✅ Cria Merge Request / Pull Request automaticamente
- ✅ Faz merge automático da MR/PR
- ✅ Limpa branches temporárias
- ✅ *(Opcional)* Atualiza status de tarefas no gerenciador de projetos do repo (ClickUp, Jira, …) **somente se** MCP/skill dessa tool estiver configurado


**Exemplo de uso:**
```
git staging
```

**Mensagens de commit suportadas:**
- `feat:` Nova funcionalidade
- `fix:` Correção de bug
- `docs:` Documentação
- `refactor:` Refatoração
- `chore:` Tarefas de manutenção

---

### 2. `git prod` - Staging → Produção

Promove mudanças aprovadas de `origin/staging` para `origin/main` (produção).

**⚠️ ATENÇÃO:** Este comando atualiza produção. Use com cuidado!

**O que faz:**
- ✅ Validação crítica de segurança
- ✅ Verifica `CHANGELOG.md` e **fecha a release** (move `[Unreleased]` → versão datada)
- ✅ Mostra resumo detalhado das mudanças
- ✅ **Requer confirmação explícita** antes de prosseguir
- ✅ Faz merge de `origin/staging` → `origin/main`
- ✅ Publica em produção
- ✅ Neste monorepo: dispara o sync do espelho público (`pnpm git:trigger-public-sync`) quando aplicável
- ✅ *(Opcional)* Atualiza status de tarefas no gerenciador de projetos do repo (ClickUp, Jira, …) **somente se** MCP/skill dessa tool estiver configurado


**Exemplo de uso:**
```
git prod
```

**Antes de executar:**
- Certifique-se de que todas as mudanças foram testadas em staging
- Verifique se o `CHANGELOG.md` está atualizado
- Revise o resumo de mudanças apresentado pelo comando

---

## 🔒 Proteções e Validações

### Travamento de Commits Diretos em Main

**IMPORTANTE**: Commits diretos em `origin/main` são **BLOQUEADOS**. Todas as mudanças devem seguir o fluxo:

1. Desenvolvimento local → `origin/staging` (via `git staging`)
2. `origin/staging` → `origin/main` (via `git prod`)

**Validações obrigatórias:**
- ❌ **BLOQUEADO**: Push direto para `origin/main`
- ❌ **BLOQUEADO**: Merge direto de branches locais para `origin/main`
- ✅ **PERMITIDO**: Apenas promoção de `origin/staging` para `origin/main` via `git prod`

---

## ⚙️ Configuração Inicial

### Criar branch de staging

```bash
# Criar branch de staging
git checkout main
git pull origin main
git checkout -b staging
git push -u origin staging
```

**Configurar proteção de branches (GitLab ou GitHub):**
- **GitLab:** `Settings` → `Repository` → `Protected branches`
- **GitHub:** `Settings` → `Branches` → Branch protection rules

Configure:
- **Branch `main`**: Allowed to merge/push: Maintainers (ou equivalente)
- **Branch `staging`**: Allowed to merge/push: Developers + Maintainers (ou equivalente)

**Verificar remotes:**
```bash
git remote -v
```

---

## 📝 Padrões e Convenções

### Semantic Versioning

Seguimos o padrão [Semantic Versioning](https://semver.org/):
- **MAJOR** (X.0.0): Mudanças incompatíveis
- **MINOR** (0.X.0): Novas funcionalidades compatíveis
- **PATCH** (0.0.X): Correções de bugs

### Conventional Commits

Seguimos o padrão [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` Nova funcionalidade
- `fix:` Correção de bug
- `docs:` Documentação
- `style:` Formatação (não afeta código)
- `refactor:` Refatoração
- `perf:` Melhoria de performance
- `test:` Testes
- `chore:` Tarefas de manutenção

### CHANGELOG.md

O `CHANGELOG.md` deve ser atualizado para mudanças significativas:

```markdown
## [Unreleased]

## [YYYY.MM.DD] - YYYY-MM-DD
ou
## [MAJOR.MINOR.PATCH] - YYYY-MM-DD

### Adicionado
- Descrição do que foi adicionado

### Alterado
- Descrição do que foi alterado

### Removido
- Descrição do que foi removido

### Corrigido
- Descrição do que foi corrigido
```

**Regra do fluxo:**
- **`git staging`:** acrescentar bullets só em `[Unreleased]`.
- **`git prod`:** antes do merge `staging → main`, **fechar a release** - mover tudo de `[Unreleased]` para `## [YYYY.MM.DD] - YYYY-MM-DD` (hoje) ou versão SemVer e deixar `[Unreleased]` vazio. Nunca promover com Unreleased cheio.

---

## ⚠️ Avisos Importantes

1. **NUNCA** faça commit direto em `origin/main` sem passar por staging
2. **SEMPRE** atualize o `CHANGELOG.md` para mudanças significativas
3. **SEMPRE** use mensagens de commit semânticas (Conventional Commits)
4. **SEMPRE** valide mudanças antes de promover para produção
5. **NUNCA** force push em branches protegidas sem autorização explícita
6. **SEMPRE** revise o resumo de mudanças antes de executar `git prod`

---

## 🔧 Requisitos

- Git configurado
- CLI do provedor: **GitLab** use `glab` ([GitLab CLI](https://gitlab.com/gitlab-org/cli)); **GitHub** use `gh` ([GitHub CLI](https://cli.github.com/)). Instale e autentique conforme seu repositório remoto.
- Permissões adequadas nas branches (Developer para `staging`, Maintainer para `main`)

**Opcional — gerenciador de projetos:** Se o projeto tiver MCP/skill de uma PM tool (ClickUp, Jira, Linear, etc.), as rotinas `git staging` e `git prod` podem atualizar status de tarefas relacionadas. O Agent Kit **não exige** nenhuma PM tool; sem integração, a etapa é ignorada.


---

## 📚 Estrutura de Branches

```
main (produção)
  ↑
staging (pré-produção)
  ↑
feature/* (desenvolvimento)
update/* (atualizações rápidas)
```

---

## 🆘 Troubleshooting

### Erro: "Commits diretos em main são bloqueados"
**Solução**: Use `git staging` para promover mudanças via staging.

### Erro: "Branch protegida"
**Solução**: Verifique suas permissões no GitLab/GitHub. Developers podem trabalhar em `staging`, apenas Maintainers podem fazer merge em `main`.

### Erro: "glab não autenticado" ou "gh não autenticado"
**Solução**: Execute `glab auth login` (GitLab) ou `gh auth login` (GitHub) para autenticar.

### Erro: "Branch staging não encontrada"
**Solução**: Crie a branch com `git checkout -b staging` e publique com `git push -u origin staging`. Em repositórios legados com `homologacao`, crie `staging` a partir dela e migre.

---

## 🤖 Prompts Técnicos para AI

Esta seção contém os prompts detalhados que devem ser seguidos quando os comandos são executados via AI.

### Prompt: git staging

> ### Sempre que eu digitar `git staging` (ou o legado `git homolog`) no chat, siga exatamente a rotina abaixo para atualizar `origin/staging` com as alterações locais:

#### 1. **Validação de Segurança**  
   - Execute `git status -sb` para verificar arquivos modificados, staged e a branch atual.
   - **TRAVA**: Se estiver tentando fazer commit direto em `main` ou `origin/main`, BLOQUEIE e informe: "Commits diretos em main são bloqueados. Use 'git staging' para promover mudanças via staging."
   - Se existirem alterações locais não commitadas que não pertencem ao fluxo atual, pare e solicite instruções.

#### 2. **Verificar e Atualizar CHANGELOG.md**  
   - Verifique se `CHANGELOG.md` existe e leia seu conteúdo.
   - Se houver mudanças significativas, **OBRIGATÓRIO** atualizar o `CHANGELOG.md`:
     - Acrescentar bullets **somente em `[Unreleased]`** (não criar versão nova aqui)
     - Seções: `### Adicionado`, `### Alterado`, `### Removido`, `### Corrigido`
     - Descrever mudanças de forma clara e objetiva
   - Se não houver mudanças significativas, confirme que não é necessário atualizar o CHANGELOG.
   - **Não** fechar release nesta rotina - isso é responsabilidade do `git prod`.

#### 3. **Garantir branch staging local**  
   - Execute `git checkout staging` para mudar para a branch staging local.
   - Se a branch não existir localmente, execute `git checkout -b staging origin/staging` (se existir remotamente) ou `git checkout -b staging`.
   - Caso o checkout falhe (por conflitos ou alterações locais), resolva seguindo orientações do usuário antes de prosseguir.

#### 4. **Sincronizar com origin/staging**  
   - Execute `git fetch --prune` para atualizar referências remotas.
   - Execute `git pull --ff-only origin staging` para sincronizar com `origin/staging`.
   - Se o pull exigir merge ou rebase, interrompa e informe o usuário.

#### 5. **Criar branch de trabalho**  
   - Analise as atualizações necessárias e defina um nome de branch seguindo o padrão: `update/<escopo>-<descriptor>` ou `feature/<nome-feature>`.
   - Utilize `git checkout -b update/<...>` ou `git checkout -b feature/<...>` para criar e mudar para a nova branch.

#### 6. **Aplicar e revisar atualizações**  
   - Realize as alterações solicitadas (incluindo atualização do CHANGELOG.md se necessário).
   - Revise com `git status -sb` para garantir que apenas os arquivos esperados foram modificados.
   - **Validação**: Confirme que não há tentativa de modificar `origin/main` diretamente.

#### 7. **Stage e commit com mensagem semântica**  
   - Adicione arquivos relevantes com `git add`.
   - Crie um commit seguindo [Conventional Commits](https://www.conventionalcommits.org/):
     - `feat:` para novas funcionalidades
     - `fix:` para correções de bugs
     - `docs:` para documentação
     - `refactor:` para refatorações
     - `chore:` para tarefas de manutenção
   - Exemplo: `git commit -m "feat: adiciona suporte a novo agente"` ou `git commit -m "fix: corrige validação de CPF"`
   - Se o CHANGELOG.md foi atualizado, mencione isso no commit: `git commit -m "feat: adiciona novo agente\n\nAtualiza CHANGELOG.md com nova versão"`

#### 8. **Publicar branch**  
   - Execute `git push -u origin update/<...>` ou `git push -u origin feature/<...>` para enviar a branch ao remoto.

#### 9. **Abrir e mesclar Merge Request / Pull Request**  
   - **GitLab:** Crie a MR com `glab mr create --title "<título>" --description "<descrição>" --target-branch staging`. Em seguida execute `glab mr merge <número>` para mesclar. Se falhar por autenticação, forneça o link de criação manual e aguarde instruções.
   - **GitHub:** Crie a PR com `gh pr create --title "<título>" --body "<descrição>" --base staging`. Em seguida execute `gh pr merge <número>` (ou o número retornado). Se falhar por autenticação, forneça o link de criação manual e aguarde instruções.

#### 10. **Limpeza e atualização final**  
   - Execute `git checkout staging` para retornar à branch de staging (necessário antes de deletar a branch de trabalho).
   - Delete a branch remota no origin com `git push origin --delete update/<...>` ou `git push origin --delete feature/<...>`.
   - Delete a branch local com `git branch -D update/<...>` ou `git branch -D feature/<...>` (use `-D` pois o merge foi feito remotamente e o Git pode não detectar localmente).
   - Atualize o `staging` local com `git pull --ff-only origin staging` para incorporar as mudanças mescladas.
   - Confirme estado limpo com `git status -sb`.

#### 10.5. **Gerenciador de projetos — opcional**  
   - **Se** o projeto tiver MCP/skill de PM tool configurado: atualizar status das tarefas relacionadas (ex.: "em staging"). Se o usuário indicou tarefa(s) ou houver contexto no handoff/plano, atualize-as. Sem tool ou sem tarefas: pule sem aviso.


#### 11. **Relatório**  
   - Resuma as ações executadas, informe o status do merge, mencione se o CHANGELOG.md foi atualizado e quaisquer follow-ups necessários.
   - Atualize `.cursor/HANDOFF.md` (fase em staging); se couber, memory-loop WRITE.

---

### Prompt: git prod

> ### Sempre que eu digitar `git prod` no chat, siga exatamente a rotina abaixo para promover mudanças de `origin/staging` para `origin/main` (produção):

#### 1. **Validação de Segurança CRÍTICA**  
   - Execute `git status -sb` para verificar arquivos modificados, staged e a branch atual.
   - **TRAVA CRÍTICA**: 
     - ❌ **BLOQUEADO**: Se houver alterações locais não commitadas, BLOQUEIE e informe: "Não é possível promover para produção com alterações locais não commitadas. Faça commit ou descarte as alterações primeiro."
     - ❌ **BLOQUEADO**: Se estiver tentando fazer commit direto em `main` ou `origin/main` sem passar por `origin/staging`, BLOQUEIE e informe: "Commits diretos em main são bloqueados. Todas as mudanças devem passar por staging primeiro."
     - ✅ **PERMITIDO**: Apenas promoção de `origin/staging` para `origin/main` após aprovação em staging.

#### 2. **Verificar versionamento e CHANGELOG.md**  
   - Execute `git fetch origin` para atualizar referências.
   - Execute `git log origin/staging --oneline -10` para verificar commits recentes.
   - **Fechar release (obrigatório se `[Unreleased]` tiver conteúdo):**
     1. Mover todos os bullets de `[Unreleased]` para `## [YYYY.MM.DD] - YYYY-MM-DD` (data de hoje) ou versão SemVer. Se a seção do dia já existir, **mesclar** nela.
     2. Deixar `[Unreleased]` vazio (só o heading).
     3. Commitar essa mudança na branch de trabalho / staging **antes** do merge em `main` (via MR se necessário).
   - Se Unreleased já estiver vazio e a release do dia refletir o que está em staging, seguir.

#### 3. **Sincronizar branches**  
   - Execute `git fetch --prune` para atualizar referências remotas.
   - Verifique se a branch `staging` existe remotamente com `git branch -r | grep origin/staging`.
   - Se não existir, informe o usuário e pare.

#### 4. **Atualizar branch staging local**  
   - Execute `git checkout staging` para mudar para a branch de staging.
   - Execute `git pull --ff-only origin staging` para sincronizar com o remoto.
   - Se o pull exigir merge ou rebase, interrompa e informe o usuário.

#### 5. **Verificar diferenças entre origin/staging e origin/main**  
   - Execute `git fetch origin main` para buscar a branch main do remoto.
   - Execute `git log origin/main..origin/staging --oneline` para listar commits que estão em `origin/staging` mas não em `origin/main`.
   - Execute `git diff origin/main..origin/staging --stat` para ver um resumo das mudanças.
   - **Apresente ao usuário um resumo detalhado das mudanças que serão promovidas para produção e solicite confirmação explícita antes de prosseguir.**

#### 6. **Atualizar main local**  
   - Execute `git checkout main` para mudar para a branch principal.
   - Execute `git pull --ff-only origin main` para garantir que está atualizada.
   - Se o pull exigir merge ou rebase, interrompa e informe o usuário.

#### 7. **Merge de origin/staging para origin/main**  
   - **Gerar mensagem de commit dinâmica** baseada nos commits sendo promovidos:
     - Analise os commits listados em `git log origin/main..origin/staging --oneline`.
     - Crie um resumo conciso (máximo 72 caracteres) que reflita as principais mudanças.
     - **Formato da mensagem**: `Merge origin/staging: <resumo das mudanças>`
     - **Exemplos**:
       - Se os commits são sobre documentação: `Merge origin/staging: Atualiza documentação e remove arquivos obsoletos`
       - Se os commits são sobre features: `Merge origin/staging: Adiciona sistema de campanhas e correções de testes`
       - Se os commits são sobre fixes: `Merge origin/staging: Correções de bugs no backend e validações`
       - Se são mudanças mistas, priorize as mais significativas: `Merge origin/staging: Nova API de eventos + docs atualizados`
     - **Dica**: Use os prefixos dos commits (feat, fix, docs, etc.) para identificar o tipo predominante de mudança.
   - Execute `git merge --no-ff origin/staging -m "<mensagem gerada>"` para fazer o merge preservando histórico.
   - Se houver conflitos, interrompa e informe o usuário para resolução manual.

#### 8. **Validar merge**  
   - Execute `git status -sb` para verificar que o merge foi concluído.
   - Execute `git log --oneline -5` para confirmar que os commits foram incorporados.
   - Verifique se o CHANGELOG.md está presente e atualizado.

#### 9. **Publicar main (PRODUÇÃO)**  
   - **ATENÇÃO**: Esta é a etapa crítica que atualiza produção.
   - Execute `git push origin main` para enviar as mudanças para produção.
   - Se o push falhar (por exemplo, branch protegida), informe o usuário e forneça instruções alternativas.
   - **NUNCA** force push (`--force` ou `--force-with-lease`) sem autorização explícita do usuário.

#### 10. **Sincronizar staging (opcional)**  
   - Execute `git checkout staging` para retornar à branch de staging.
   - Execute `git merge --ff-only origin/main` para sincronizar staging com main (se aplicável).
   - Execute `git push origin staging` para atualizar o remoto.

#### 11. **Limpeza e confirmação**  
   - Execute `git checkout main` para retornar à branch principal.
   - Execute `git status -sb` para confirmar estado limpo.
   - Execute `git log --oneline -10` para mostrar os últimos commits incluindo o merge.

#### 11.5. **Gerenciador de projetos — opcional**  
   - **Se** o projeto tiver MCP/skill de PM tool configurado: atualizar status das tarefas relacionadas à promoção (ex.: "concluído"). Sem tool ou sem tarefas: pule sem aviso.

#### 12. **Sync do espelho público (este monorepo)**  
   - Com remote `public` configurado e `gh` autenticado, execute **`pnpm git:trigger-public-sync`** (ou `bash scripts/trigger-public-sync-after-prod.sh`) para disparar o workflow CI com sync do repositório público. Ver `docs/repository-boundaries.md`.
   - Em projetos sem espelho público, pule esta etapa.

#### 13. **Relatório Final**  
   - Resuma as ações executadas, liste os commits promovidos para produção, informe o status do merge, mencione se o CHANGELOG.md foi atualizado e quaisquer follow-ups necessários.
   - **Destaque**: Informe claramente que as mudanças estão agora em produção (`origin/main`).
   - Atualize `.cursor/HANDOFF.md` ("promovido a produção"); se couber, memory-loop WRITE.

---

## Nomenclatura: `staging`, `homologacao` e migração

- **Canônico:** `staging` (i18n, alinhado a GitHub/GitLab e aos demais projetos do ecossistema).
- **Legado:** repositórios antigos podem ainda ter `homologacao`; `git homolog` é aceito como sinônimo de `git staging` e opera na branch de pré-prod existente.
- **Migração:** criar `staging` a partir de `homologacao` (`git checkout homologacao && git checkout -b staging && git push -u origin staging`), atualizar proteção de branches e MRs abertas, e então aposentar `homologacao`.
- **Produção** é *ambiente* de deploy/CI, não nome obrigatório de branch — `main` permanece o destino do `git prod`.
