# Checklist: Alteração n8n/JSON

## Identificação
- **Workflow:** [nome]
- **Arquivo:** [path]
- **Tipo de alteração:** [novo|edit|delete]

## Pré-alteração
- [ ] Backup criado em `.cursor/context/backups/`
- [ ] JSON atual é válido
- [ ] Entendo a estrutura atual

## Estrutura n8n
- [ ] Webhook tem responseMode: "responseNode" quando usado com Respond Webhook
- [ ] Todas as ramificações terminam em Respond Webhook (ou NoOp se não responder)
- [ ] IDs de nodes são únicos e seguem padrão kebab-case

## Connections
- [ ] Todas as conexões apontam para nodes existentes
- [ ] Nenhum node órfão (sem entrada e saída, exceto Webhook e Respond)
- [ ] Execute Workflow tem workflowId preenchido (não vazio)

## Credentials
- [ ] Credentials referenciadas por id (não hardcoded)
- [ ] Nenhum secret no JSON (buscar: password, token, key, secret)
- [ ] Documentar credentials necessárias em README

## Alteração
- [ ] Nodes adicionados/editados estão corretos
- [ ] Connections estão corretas (from → to)
- [ ] Referências $json apontam para node correto na cadeia
- [ ] $('NodeName') usa nome exato (case-sensitive)
- [ ] Nodes Postgres com RETURNING quando dados são usados depois

## Validação
- [ ] JSON é válido após alteração
- [ ] Script n8n-checker passa sem erros: `node .cursor/hooks/lib/n8n-checker.js <arquivo>`
- [ ] Nenhum secret hardcoded

## Documentação
- [ ] README atualizado (se necessário)
- [ ] docs/n8n-manual-update-*.md criado (se alteração manual)

## Teste
- [ ] Workflow testado no n8n (importar e executar)
- [ ] Fluxo principal funciona
- [ ] Erros tratados corretamente
