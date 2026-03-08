#!/usr/bin/env node
// mcp-entry.js

const path      = require('path');
const MCPServer = require('./src/mcp-server');

const projectPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

const server = new MCPServer(projectPath);
server.start();
