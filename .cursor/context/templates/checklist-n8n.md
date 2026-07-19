# Checklist: n8n/JSON Change

## Identification
- **Workflow:** [name]
- **File:** [path]
- **Change type:** [new|edit|delete]

## Pre-change
- [ ] Backup created in `.cursor/context/backups/`
- [ ] Current JSON is valid
- [ ] I understand the current structure

## n8n Structure
- [ ] Webhook has responseMode: "responseNode" when used with Respond Webhook
- [ ] All branches end in Respond Webhook (or NoOp if not responding)
- [ ] Node IDs are unique and follow kebab-case pattern

## Connections
- [ ] All connections point to existing nodes
- [ ] No orphaned nodes (without input and output, except Webhook and Respond)
- [ ] Execute Workflow has workflowId filled (not empty)

## Credentials
- [ ] Credentials referenced by id (not hardcoded)
- [ ] No secrets in JSON (search for: password, token, key, secret)
- [ ] Document required credentials in README

## Change
- [ ] Added/edited nodes are correct
- [ ] Connections are correct (from → to)
- [ ] $json references point to correct node in the chain
- [ ] $('NodeName') uses exact name (case-sensitive)
- [ ] Postgres nodes with RETURNING when data is used later

## Validation
- [ ] JSON is valid after change
- [ ] n8n-checker script passes without errors: `node .cursor/hooks/lib/n8n-checker.js <file>`
- [ ] No hardcoded secrets

## Documentation
- [ ] README updated (if necessary)
- [ ] docs/n8n-manual-update-*.md created (if manual change)

## Testing
- [ ] Workflow tested in n8n (import and execute)
- [ ] Main flow works
- [ ] Errors handled correctly
