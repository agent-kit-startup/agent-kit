#!/usr/bin/env node
/**
 * n8n Workflow Checker - Valida integridade de workflows n8n (nodes, connections, credentials).
 * Uso: node n8n-checker.js <workflow.json> [workflow2.json ...]
 * Ou importar: const { validateN8nWorkflow } = require('./n8n-checker.js');
 */

const fs = require('fs');
const path = require('path');

/**
 * Valida um objeto de workflow n8n.
 * @param {object} workflow - Objeto workflow (nodes, connections, etc.)
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateN8nWorkflow(workflow) {
  const errors = [];
  const warnings = [];
  const nodes = workflow.nodes || [];
  const connections = workflow.connections || {};
  const nodeNames = new Set(nodes.map((n) => n.name));
  const connectedNodes = new Set();

  Object.entries(connections).forEach(([from, outputs]) => {
    connectedNodes.add(from);
    const main = outputs.main;
    if (Array.isArray(main)) {
      main.forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((c) => {
            if (c && typeof c.node === 'string') connectedNodes.add(c.node);
          });
        }
      });
    }
  });

  nodes.forEach((node) => {
    if (
      !connectedNodes.has(node.name) &&
      node.type !== 'n8n-nodes-base.webhook' &&
      node.type !== 'n8n-nodes-base.respondToWebhook'
    ) {
      warnings.push(`Node órfão: ${node.name}`);
    }
  });

  Object.entries(connections).forEach(([from, outputs]) => {
    if (!nodeNames.has(from)) {
      errors.push(`Connection de node inexistente: ${from}`);
    }
    const main = outputs.main;
    if (Array.isArray(main)) {
      main.forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((c) => {
            if (c && typeof c.node === 'string' && !nodeNames.has(c.node)) {
              errors.push(`Connection para node inexistente: ${c.node}`);
            }
          });
        }
      });
    }
  });

  nodes.forEach((node) => {
    if (node.type === 'n8n-nodes-base.executeWorkflow') {
      const params = node.parameters || {};
      const wfId = params.workflowId?.value ?? params.workflowId;
      if (!wfId) {
        errors.push(`Execute Workflow sem ID: ${node.name}`);
      }
    }
  });

  const jsonStr = JSON.stringify(workflow);
  const secretPatterns = [
    /password["']?\s*:\s*["'][^"']+["']/gi,
    /api[_-]?key["']?\s*:\s*["'][^"']+["']/gi,
    /secret["']?\s*:\s*["'][^"']+["']/gi,
    /token["']?\s*:\s*["'][^"']+["']/gi
  ];

  secretPatterns.forEach((pattern) => {
    if (pattern.test(jsonStr)) {
      errors.push('Possível secret hardcoded detectado no workflow');
    }
  });

  return { errors, warnings };
}

/**
 * Valida um arquivo de workflow n8n.
 * @param {string} filePath - Caminho do arquivo JSON
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateN8nFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { valid: false, errors: [`Não foi possível ler o arquivo: ${e.message}`], warnings: [] };
  }

  let workflow;
  try {
    workflow = JSON.parse(content);
  } catch (e) {
    return { valid: false, errors: [`JSON inválido: ${e.message}`], warnings: [] };
  }

  const hasNodes = Array.isArray(workflow.nodes) && workflow.nodes.length > 0;
  const hasConnections = workflow.connections && typeof workflow.connections === 'object';
  if (!hasNodes && !hasConnections) {
    return {
      valid: true,
      errors: [],
      warnings: ['Arquivo não parece ser um workflow n8n (sem nodes/connections)']
    };
  }

  const { errors, warnings } = validateN8nWorkflow(workflow);
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node n8n-checker.js <workflow.json> [workflow2.json ...]');
    process.exit(2);
  }

  let hasError = false;

  for (const file of args) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`Arquivo não encontrado: ${file}`);
      hasError = true;
      continue;
    }
    const result = validateN8nFile(resolved);
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.error(`[${file}] ${e}`));
      hasError = true;
    }
    if (result.warnings.length > 0) {
      result.warnings.forEach((w) => console.warn(`[${file}] ${w}`));
    }
  }

  process.exit(hasError ? 1 : 0);
}

if (require.main === module) {
  main();
} else {
  module.exports = { validateN8nWorkflow, validateN8nFile };
}
