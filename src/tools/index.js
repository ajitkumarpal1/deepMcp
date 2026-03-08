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
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

async function callTool(name, args, context) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return await tool.handler(args, context);
}

module.exports = { getToolsList, callTool };
