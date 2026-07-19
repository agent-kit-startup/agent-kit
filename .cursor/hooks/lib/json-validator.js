#!/usr/bin/env node
/**
 * JSON Validator - Validates JSON file syntax and formatting.
 * Usage: node json-validator.js <file> [file2 ...]
 * Or import: const { validateJson } = require('./json-validator.js');
 */

const fs = require('fs');
const path = require('path');

/**
 * Validates JSON content.
 * @param {string} content - File content
 * @param {string} [filePath] - File path (for error messages)
 * @returns {{ valid: boolean, error?: string, warning?: string }}
 */
function validateJson(content, filePath = '') {
  const label = filePath ? ` in ${filePath}` : '';

  try {
    JSON.parse(content);
  } catch (e) {
    return {
      valid: false,
      error: `Syntax error${label}: ${e.message}`
    };
  }

  if (content.includes('//') || content.includes('/*')) {
    return {
      valid: false,
      error: `JSON does not support comments${label}. Use _comment if you need notes.`
    };
  }

  const formatted = JSON.stringify(JSON.parse(content), null, 2);
  if (content.trim() !== formatted) {
    return {
      valid: true,
      warning: `Inconsistent formatting${label}. Prefer 2-space indentation.`
    };
  }

  return { valid: true };
}

/**
 * Validates a JSON file on disk.
 * @param {string} filePath - File path
 * @returns {{ valid: boolean, error?: string, warning?: string }}
 */
function validateJsonFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { valid: false, error: `Could not read file: ${e.message}` };
  }
  return validateJson(content, filePath);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node json-validator.js <file> [file2 ...]');
    process.exit(2);
  }

  let hasError = false;
  let hasWarning = false;

  for (const file of args) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${file}`);
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
