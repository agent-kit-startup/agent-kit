#!/usr/bin/env node
/**
 * JSON Validator - Valida sintaxe e formatação de arquivos JSON.
 * Uso: node json-validator.js <file> [file2 ...]
 * Ou importar: const { validateJson } = require('./json-validator.js');
 */

const fs = require('fs');
const path = require('path');

/**
 * Valida conteúdo JSON.
 * @param {string} content - Conteúdo do arquivo
 * @param {string} [filePath] - Caminho do arquivo (para mensagens de erro)
 * @returns {{ valid: boolean, error?: string, warning?: string }}
 */
function validateJson(content, filePath = '') {
  const label = filePath ? ` em ${filePath}` : '';

  try {
    JSON.parse(content);
  } catch (e) {
    return {
      valid: false,
      error: `Erro de sintaxe${label}: ${e.message}`
    };
  }

  if (content.includes('//') || content.includes('/*')) {
    return {
      valid: false,
      error: `JSON não suporta comentários${label}. Use _comment se precisar de nota.`
    };
  }

  const formatted = JSON.stringify(JSON.parse(content), null, 2);
  if (content.trim() !== formatted) {
    return {
      valid: true,
      warning: `Formatação inconsistente${label}. Preferir indentação de 2 espaços.`
    };
  }

  return { valid: true };
}

/**
 * Valida um arquivo JSON no disco.
 * @param {string} filePath - Caminho do arquivo
 * @returns {{ valid: boolean, error?: string, warning?: string }}
 */
function validateJsonFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { valid: false, error: `Não foi possível ler o arquivo: ${e.message}` };
  }
  return validateJson(content, filePath);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node json-validator.js <file> [file2 ...]');
    process.exit(2);
  }

  let hasError = false;
  let hasWarning = false;

  for (const file of args) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`Arquivo não encontrado: ${file}`);
      hasError = true;
      continue;
    }
    const result = validateJsonFile(resolved);
    if (!result.valid) {
      console.error(result.error);
      hasError = true;
    } else if (result.warning) {
      console.warn(result.warning);
      hasWarning = true;
    }
  }

  if (hasError) process.exit(1);
  if (hasWarning) process.exit(0);
  process.exit(0);
}

if (require.main === module) {
  main();
} else {
  module.exports = { validateJson, validateJsonFile };
}
