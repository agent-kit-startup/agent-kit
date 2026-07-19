#!/usr/bin/env node
/**
 * n8n Workflow Checker - Validates n8n workflow integrity (nodes, connections, credentials).
 * Usage: node n8n-checker.js <workflow.json> [workflow2.json ...]
 * Or import: const { validateN8nWorkflow } = require('./n8n-checker.js');
 */

const fs = require('fs');
const path = require('path');

/**
 * Validates an n8n workflow object.
 * @param {object} workflow - Workflow object (nodes, connections, etc.)
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
      warnings.push(`Orphan node: ${node.name}`);
    }
  });

  Object.entries(connections).forEach(([from, outputs]) => {
    if (!nodeNames.has(from)) {
      errors.push(`Connection from non-existent node: ${from}`);
    }
    const main = outputs.main;
    if (Array.isArray(main)) {
      main.forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((c) => {
            if (c && typeof c.node === 'string' && !nodeNames.has(c.node)) {
              errors.push(`Connection to non-existent node: ${c.node}`);
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
        errors.push(`Execute Workflow without ID: ${node.name}`);
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
      errors.push('Possible hardcoded secret detected in workflow');
    }
  });

  return { errors, warnings };
}

/**
 * Validates an n8n workflow file.
 * @param {string} filePath - Path to JSON file
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateN8nFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { valid: false, errors: [`Could not read file: ${e.message}`], warnings: [] };
  }

  let workflow;
  try {
    workflow = JSON.parse(content);
  } catch (e) {
    return { valid: false, errors: [`Invalid JSON: ${e.message}`], warnings: [] };
  }

  const hasNodes = Array.isArray(workflow.nodes) && workflow.nodes.length > 0;
  const hasConnections = workflow.connections && typeof workflow.connections === 'object';
  if (!hasNodes && !hasConnections) {
    return {
      valid: true,
      errors: [],
      warnings: ['File does not appear to be an n8n workflow (no nodes/connections)']
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
    console.error('Usage: node n8n-checker.js <workflow.json> [workflow2.json ...]');
    process.exit(2);
  }

  let hasError = false;

  for (const file of args) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${file}`);
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
