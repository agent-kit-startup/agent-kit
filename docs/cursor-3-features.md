# Cursor 3.0 Features - Como o Agent Kit Usa

Agent Kit ajuda a desenvolver sem perder contexto - e usa features nativas do Cursor como **complemento**, não substituição.

## Posição do Agent Kit

O handoff em arquivo (`.cursor/HANDOFF.md`) é a **fonte da verdade** para continuidade. Nenhuma IDE garante memória infinita - o limite de contexto é real, e sessões novas começam do zero. Por isso o Agent Kit mantém estado em disco: planos estruturados, progresso, e rotinas sugeridas.

## Features nativas e como usar

| Feature | O que faz | Como o Agent Kit usa |
|---------|-----------|----------------------|
| `/resume` | Retoma conversa anterior | Complemento ao HANDOFF - bom para referência rápida, não substitui estado em arquivo |
| Summaries | Resumo automático de sessões longas | Útil para revisitar decisões; handoff continua obrigatório |
| Transcripts / @mentions | Busca em chats anteriores | Referência cruzada; não substitui plano com to-dos |
| Agents Window | Múltiplos agentes em paralelo | Cada agente lê HANDOFF antes de agir; estado compartilhado é em arquivo |
| `/worktree` | Git worktree isolado | Para mudanças arriscadas sem sujar a working tree |
| `/best-of-n` | Comparar abordagens lado a lado | Para decisões de arquitetura |
| Plans | Planos nativos do Cursor | Agent Kit gera planos com to-dos no frontmatter; HANDOFF referencia o plano ativo |

## MCP, hooks e SDK

**Gateways de agente paralelos ao Cursor não fazem parte do stack do Agent Kit** - não documentamos nem versionamos config para isso.

Para extensões e automação, use o que o próprio Cursor oferece:

- **MCP** - servidores suportados pelo Cursor (ex.: integrações oficiais ou documentadas no ecossistema; no IDE, preferir o que já vem habilitado ou `mcp.json` do projeto para ferramentas estáveis).
- **Hooks** - eventos do agente no workspace (ver skill `create-hook` na sua instalação Cursor, se aplicável).
- **`@cursor/sdk`** - agentes e fluxos fora do IDE quando fizer sentido (ver documentação do SDK).

Isso mantém um único lugar de verdade para ferramentas do agente e evita duplicar controle de sessão fora do modelo nativo.

## Regra prática

1. **Planejar cada task para ~50% da janela** - sobra espaço para execução + handoff
2. **Após cada task**: gravar HANDOFF, atualizar to-dos, sugerir git staging
3. **Nova conversa**: `/continue-plan` lê HANDOFF e retoma
4. **Agentes paralelos**: cada um lê HANDOFF antes de começar

## O que NÃO confiar

- **Memória infinita na mesma thread** - não existe
- **Outro agente saber o que você fez** - contextos são separados
- **Continuidade automática entre sessões** - summaries ajudam mas não garantem
- **`/resume` como substituto de handoff** - bom para relembrar, não para retomar trabalho complexo
