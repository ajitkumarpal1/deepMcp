// src/mcp-server.js
const { getToolsList, callTool, validateToolArgs } = require('./tools');

// In MCP mode all diagnostics MUST go to stderr — stdout is the JSON-RPC channel.
const log = (...a) => process.stderr.write('[MCP] ' + a.join(' ') + '\n');

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
    log(`Server ready. Project: ${this.projectPath}`);
  }

  _send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }

  _error(id, code, message) {
    this._send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async _handleMessage(raw) {
    if (process.env.DEBUG) {
      log(`→ ${raw.substring(0, 120)}`);
    }

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
          // Notification — no response required
          break;

        case 'tools/list':
          this._send({
            jsonrpc: '2.0', id,
            result: { tools: getToolsList() }
          });
          break;

        case 'tools/call': {
          const { name, arguments: args } = params || {};

          if (!name) {
            return this._error(id, -32602, 'Missing "name" in tools/call params');
          }

          // Validate required arguments against the tool's inputSchema
          const validationError = validateToolArgs(name, args || {});
          if (validationError) {
            return this._error(id, -32602, validationError);
          }

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
      log(`Error handling "${method}": ${err.message}`);
      this._error(id, -32603, err.message);
    }
  }
}

module.exports = MCPServer;
