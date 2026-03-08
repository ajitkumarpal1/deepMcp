// src/mcp-server.js
const { getToolsList, callTool } = require('./tools');

class MCPServer {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.context     = { projectPath };
    this._buf        = '';
  }

  start() {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      this._buf += chunk;
      const lines = this._buf.split('\n');
      this._buf = lines.pop(); // keep incomplete line
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) this._handleMessage(trimmed);
      }
    });
    // stderr only — stdout is for JSON-RPC!
    process.stderr.write(`[MCP] Server ready. Project: ${this.projectPath}\n`);
  }

  _send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  _error(id, code, message) {
    this._send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async _handleMessage(raw) {
    let req;
    try { req = JSON.parse(raw); }
    catch { return this._error(null, -32700, 'Parse error'); }

    const { id, method, params } = req;

    try {
      switch (method) {

        case 'initialize':
          this._send({
            jsonrpc: '2.0', id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'deepseek-mcp', version: '2.0.0' }
            }
          });
          break;

        case 'initialized':
          // notification — no response needed
          break;

        case 'tools/list':
          this._send({
            jsonrpc: '2.0', id,
            result: { tools: getToolsList() }
          });
          break;

        case 'tools/call': {
          const { name, arguments: args } = params;
          const data = await callTool(name, args || {}, this.context);
          this._send({
            jsonrpc: '2.0', id,
            result: {
              content: [{
                type: 'text',
                text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
              }]
            }
          });
          break;
        }

        case 'ping':
          this._send({ jsonrpc: '2.0', id, result: {} });
          break;

        default:
          this._error(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      this._error(id, -32603, err.message);
    }
  }
}

module.exports = MCPServer;
