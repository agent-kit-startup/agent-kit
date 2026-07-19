---
name: clean-code
description: Remove AI slop (redundant comments, noisy try/catch, any casts, deep nesting, em dash "—" in text). Alias: code-deslop. Use after AI sessions or before review.
version: 0.1.0
category: quality
---

# Clean Code (code-deslop)

Comentários óbvios, defesa excessiva, `any` para calar o tipo, nesting profundo - padrões que leem como código de máquina.

## Quando usar

- Depois de sessão com IA, antes do commit
- Review de PR com trecho gerado
- Pedido explícito: deslop / limpar código de IA
- Antes de code review

Diff ou arquivo pontual: esta skill. Refatoração grande: subagente `cleancode-refactor`.

## Processo

1. `git diff` contra a base (ex.: `main`)
2. Varrer as áreas abaixo
3. Mudança mínima; mesmo comportamento salvo bug claro
4. Lint e typecheck
5. Resumo em 1–3 frases

## Focus Areas (slop patterns)

### 1. Comentários redundantes

Repetem o óbvio em vez de explicar o porquê.

```typescript
// BAD - slop
const total = items.length; // Get the total number of items
return total; // Return the total

// GOOD - no comment needed, code is self-explanatory
const total = items.length;
return total;
```

### 2. Defesa demais

Try/catch ou null check em caminho interno onde o caller já garante dado válido.

```typescript
// BAD - slop (internal helper, caller always passes valid data)
function formatName(user: User): string {
  try {
    if (!user) throw new Error('User is required');
    if (!user.name) throw new Error('Name is required');
    return user.name.trim();
  } catch (error) {
    console.error('Error formatting name:', error);
    throw error;
  }
}

// GOOD
function formatName(user: User): string {
  return user.name.trim();
}
```

### 3. `any` para fugir do tipo

Cast só para calar o checker em vez de modelar o tipo certo.

```typescript
// BAD - slop
const result = (response as any).data;

// GOOD - use the actual type
const result = (response as ApiResponse).data;
```

### 4. Nesting profundo

If/else ou try/catch empilhados; preferir early return ou guard clauses.

```typescript
// BAD - slop
function process(input: string | null) {
  if (input) {
    if (input.length > 0) {
      if (isValid(input)) {
        return transform(input);
      }
    }
  }
  return null;
}

// GOOD - early returns
function process(input: string | null) {
  if (!input || input.length === 0 || !isValid(input)) return null;
  return transform(input);
}
```

### 5. Estilo fora do arquivo

Nomes, imports, tratamento de erro ou formatação diferentes do resto do arquivo.

### 6. Travessão (em dash "—") em texto

O travessão "—" é uma das marcas mais fortes de texto gerado por IA. Em comentários, mensagens de commit, docs, README, HANDOFF e memory, ele é slop: troque por hífen, dois-pontos, vírgula, parênteses ou ponto.

```text
BAD  (slop de IA, com travessão)
feat: novo cache — reduz latência e simplifica o fluxo
o CLI faz o parse — depois valida — e então grava

GOOD
feat: novo cache reduz latência e simplifica o fluxo
o CLI faz o parse, valida e grava
o CLI faz o parse; depois valida; então grava
```

Regra: **eliminar por completo** o "—" de commits, textos e docs. Só usar quando for obrigatório por um motivo concreto (por exemplo, citar literalmente um texto externo, um dado ou uma API que já contém o caractere). Nesses casos, preservar o original.

Nota: isto vale para o repositório e para o chat. É slop textual, não só de código; ver rules `agent-output-hygiene`, `docs-professional-standard` e `ux-tone`.

## Convenções

- Mesmo comportamento observável, salvo correção de bug claro
- Edits pequenos; alinhar ao estilo local
- Comentário que explica *porquê*: mantém
- Rodar linter/typecheck depois

## Checklist

- [ ] Comentários óbvios removidos
- [ ] Try/catch e checks desnecessários removidos onde o fluxo é confiável
- [ ] `any` trocado por tipo adequado ou removido
- [ ] Nesting achatado (early return / guards)
- [ ] Travessão "—" eliminado de comentários, commits e docs tocados (só manter se for citação literal obrigatória)
- [ ] Estilo alinhado ao arquivo
- [ ] Sem metalinguagem / fofoca / raciocínio de chat em comments, commits ou docs tocados (rule `agent-output-hygiene`)
- [ ] Lint/typecheck ok; resumo curto
