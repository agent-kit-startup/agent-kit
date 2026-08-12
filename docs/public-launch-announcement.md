# Public launch announcement

Copy-paste text for announcing the public repository (chat, social, communities). Portuguese body is the shippable launch copy; keep product claims aligned with [getting-started.md](getting-started.md), the root `README.md`, and the dual-name contract (Mission Kit marketing / Agent Kit install).

Related: [Public launch go/no-go](public-launch.md). Naming: `2026-08-06_mission-kit-vs-agent-kit-naming`.

```text
Fala, devs! 🚀

Se você usa o Cursor ou outro IDE com IA assistida para codar, já deve ter passado pelo clássico problema de ver a IA se perder e alucinar quando o chat fica muito longo e o contexto enche. 🤯

Para resolver isso (e a falta de DevOps estruturado no fluxo do agente), existe o *Mission Kit 5*: development operations dentro do Cursor e do VS Code. Site: https://missionkit.io

No GitHub, npm e CLI o projeto ainda se chama *Agent Kit* (pacote `@dadado/agent-kit-cli`, comando `agent-kit`, `/agent-kit-onboard`). Mesmo produto, dois nomes de propósito. 🛠️

*🤔 O que é?*
Uma camada operacional leve que transforma seu IDE em um framework HITL: planejamento, handoff entre chats, revisão externa opcional e fluxo Git staging→prod com confirmação antes de produção. Não é marketing de "autonomia sem freio".

*✨ O que ele resolve?*
• *Onboarding & Setup Inteligente:* analisa o projeto e prepara regras, comandos e skills sob medida (`/agent-kit-onboard`). 🧠✨
• *Sem perda de contexto:* estado vivo entre chats; um comando e a IA sabe onde parou. 🔄
• *Planos de verdade:* to-dos reais, com humano no loop (Ask questions). 📋
• *DevOps integrado:* staging automático, Conventional Commits, hooks. 🛡️
• *Produção com confirmação:* staging pode ir sozinho; `main` só depois de você confirmar. 🛑
• *Mission Control:* cockpit local (`/dashboard` / `agent-kit dashboard`) sobre o que está no disco.

*🚀 Como usar?*

1️⃣ *No terminal do projeto:*
`npx @dadado/agent-kit-cli install`

2️⃣ *Ou no chat do Cursor:* cole o prompt de instalação do README (leia antes de executar).

Depois: `/agent-kit-onboard`, `/start-project`, `/continue-plan` ou `/run-plan`.

---

💡 *Quer contribuir?*
Source-available sob PolyForm Noncommercial (uso pessoal/não comercial gratuito; comercial: sales@missionkit.io). Issue ou PR no GitHub. 🤝

👉 *Site + repo:*
https://missionkit.io
https://github.com/agent-kit-startup/agent-kit

Show? Se testar, conta o que achou! 👊🔥
```
