// src/tools/index.js
const readFile   = require('./read-file');
const writeFile  = require('./write-file');
const applyPatch = require('./apply-patch');
const listFiles  = require('./list-files');
const executeCmd = require('./execute-command');
const searchCode = require('./search-code');
const undoLast   = require('./undo-last');

const TOOLS = [readFile, writeFile, applyPatch, listFiles, executeCmd, searchCode, undoLast];

function getToolsList() {
  return TOOLS.map(t => ({
    name:        t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function callTool(name, args, context) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return await tool.handler(args, context);
}

/**
 * Validates args against a tool's inputSchema.
 * Returns an error string, or null if valid.
 *
 * @param {string} name - Tool name
 * @param {object} args - Arguments to validate
 * @returns {string|null}
 */
function validateToolArgs(name, args) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return `Unknown tool: ${name}`;

  const schema = tool.inputSchema;
  if (!schema) return null;

  const required = schema.required || [];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      return `Missing required argument: "${field}"`;
    }
    const propType = schema.properties?.[field]?.type;
    if (propType && typeof args[field] !== propType) {
      return `Argument "${field}" must be of type ${propType}, got ${typeof args[field]}`;
    }
  }

  return null;
}

module.exports = { getToolsList, callTool, validateToolArgs };
