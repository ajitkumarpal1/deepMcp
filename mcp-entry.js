#!/usr/bin/env node
// mcp-entry.js — MCP server entry point
//
// IMPORTANT: Set MCP_MODE before requiring any other module.
// This ensures all loggers route to stderr, keeping stdout clean for JSON-RPC.
process.env.MCP_MODE = '1';

const path      = require('path');
const MCPServer = require('./src/mcp-server');

const projectPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

const server = new MCPServer(projectPath);
server.start();
