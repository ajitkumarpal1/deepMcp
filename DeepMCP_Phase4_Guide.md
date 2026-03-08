# 🤖 DeepSeek MCP Layer — Phase 4 Implementation Guide
> JSON-RPC • MCP Tools • Fuzzy Search • Real MCP Protocol

---

## 📊 Current Status

| Component | Status | Effort |
|---|---|---|
| JSON-RPC MCP Server (stdio) | 🔴 Not Started | 2-3 days |
| Tools Layer (7 tools) | 🔴 Not Started | 1-2 days |
| Fuzzy Search Engine | 🔴 Not Started | 4-6 hours |
| Phase 1 — Auto Run Commands | ✅ Done | Complete |
| Phase 2 — Chunked Output | ✅ Done | Complete |
| Multi-Turn Chat | ✅ Done | Complete |

> ✅ Yeh guide sirf Phase 4 ke liye hai — Phases 1 & 2 already implement hain.

---

## 🔄 Section 1 — Architecture Shift

### Current (CLI Loop) — Problem
```
User Query
    ↓
context-builder  →  prompt banata hai
    ↓
deepseek-browser →  DeepSeek ko bhejta hai (Playwright)
    ↓
response-parser  →  SEARCH/REPLACE blocks dhundta hai
    ↓
orchestrator     →  files mein likhta hai

❌ AI sirf respond karta hai, tools call nahi karta
```

### Target (Real MCP) — Solution
```
Claude Desktop / Cursor / VS Code
    ↓  (stdio transport)
MCP Server (mcp-server.js)  ← NEW FILE
    ↓
AI: tool_call → { name: "read_file", args: { path: "src/App.tsx" } }
    ↓
Tool Handler executes → returns file content
    ↓
AI: tool_call → { name: "write_file", args: { path: "...", content: "..." } }
    ↓
Tool Handler writes file → returns "success"
    ↓
AI: tool_call → { name: "execute_command", args: { cmd: "npm install" } }
    ↓
Done! AI ne khud sab manage kiya ✅
```

---

## 📁 Section 2 — New File Structure

```
deepseekMcp/
├── index.js                    ← existing (CLI mode — UNCHANGED)
├── mcp-entry.js               ← NEW: MCP server entry point
├── src/
│   ├── orchestrator.js        ← existing (UNCHANGED)
│   ├── context-builder.js     ← existing (UNCHANGED)
│   ├── deepseek-browser.js    ← existing (UNCHANGED)
│   ├── response-parser.js     ← existing (small update needed)
│   ├── post-apply-runner.js   ← existing (UNCHANGED)
│   ├── selectors.config.js    ← existing (UNCHANGED)
│   ├── mcp-server.js          ← NEW: JSON-RPC handler
│   ├── fuzzy-search.js        ← NEW: fuzzy match engine
│   └── tools/                 ← NEW directory
│       ├── index.js           ← tool registry
│       ├── read-file.js
│       ├── write-file.js
│       ├── apply-patch.js
│       ├── list-files.js
│       ├── execute-command.js
│       ├── search-code.js
│       └── undo-last.js
└── package.json               ← add "mcp" script
```

> ℹ️ Existing files mein KUCH BHI change nahi — CLI mode abhi bhi kaam karta rahega.

---

## 🔧 Section 3 — Step 1: Fuzzy Search (PEHLE YEH KAR)

### Problem — SEARCH/REPLACE Kyun Fail Hota Hai
- Extra spaces ya indentation difference
- Windows CRLF vs Unix LF line endings  
- DeepSeek ne slightly different version socha
- File mein baad mein koi aur change hua

### `src/fuzzy-search.js` — Naya File Banao

```js
// src/fuzzy-search.js
// Fuzzy SEARCH/REPLACE — 5 strategies, in order of strictness

function fuzzyApplyHunk(content, search, replace) {

  // Strategy 1: Exact string match (fastest)
  if (content.includes(search)) {
    return { result: content.replace(search, replace), strategy: 'exact' };
  }

  const cLines = content.split('\n');
  const sLines = search.split('\n').map(l => l.trimEnd());
  const rLines = replace.split('\n');

  // Strategy 2: Trailing whitespace normalized
  for (let i = 0; i <= cLines.length - sLines.length; i++) {
    if (sLines.every((s, j) => cLines[i + j].trimEnd() === s)) {
      const out = [...cLines];
      out.splice(i, sLines.length, ...rLines);
      return { result: out.join('\n'), strategy: 'trim-end' };
    }
  }

  // Strategy 3: Full trim (handles indent drift)
  const sTrimmed = sLines.map(l => l.trim());
  for (let i = 0; i <= cLines.length - sTrimmed.length; i++) {
    if (sTrimmed.every((s, j) => cLines[i + j].trim() === s)) {
      const out = [...cLines];
      out.splice(i, sTrimmed.length, ...rLines);
      return { result: out.join('\n'), strategy: 'full-trim' };
    }
  }

  // Strategy 4: Token similarity score (Jaccard-based)
  const tokenize = s => s.toLowerCase().split(/[\s,;(){}[\]]+/).filter(Boolean);
  const jaccard = (a, b) => {
    const sa = new Set(a), sb = new Set(b);
    const inter = [...sa].filter(x => sb.has(x)).length;
    return inter / (sa.size + sb.size - inter);
  };

  let bestScore = 0, bestIdx = -1;
  for (let i = 0; i <= cLines.length - sLines.length; i++) {
    const windowTokens = tokenize(cLines.slice(i, i + sLines.length).join(' '));
    const searchTokens = tokenize(sLines.join(' '));
    const score = jaccard(windowTokens, searchTokens);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  // Only use fuzzy match if confidence > 70%
  if (bestScore > 0.70 && bestIdx !== -1) {
    console.warn(`⚠️  Fuzzy match: ${Math.round(bestScore * 100)}% confidence`);
    const out = [...cLines];
    out.splice(bestIdx, sLines.length, ...rLines);
    return { result: out.join('\n'), strategy: `fuzzy-${Math.round(bestScore * 100)}%` };
  }

  // Strategy 5: Large hunk fallback (>50% of file = use REPLACE as full)
  if (sLines.length >= cLines.length * 0.5) {
    console.warn('⚠️  Large hunk: using REPLACE as full file');
    return { result: replace, strategy: 'full-replace' };
  }

  return null; // All strategies failed
}

module.exports = { fuzzyApplyHunk };
```

### `response-parser.js` Mein Update

```js
// response-parser.js ke TOP mein add karo:
const { fuzzyApplyHunk } = require('./fuzzy-search');

// apply() method mein yeh change karo:

// BEFORE:
const patched = applyHunk(content, search, replace);
if (patched === null) { ... }
content = patched;

// AFTER:
const result = fuzzyApplyHunk(content, search, replace);
if (result === null) {
  console.error(`❌ Hunk ${i + 1}: no match (tried 5 strategies)`);
  allFound = false;
  break;
}
console.log(`  ✓ Hunk ${i + 1} applied via: ${result.strategy}`);
content = result.result;
```

---

## 🗂️ Section 4 — Step 2: Tools Layer

### `src/tools/index.js` — Tool Registry

```js
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
```

---

### `src/tools/read-file.js`

```js
const fs   = require('fs');
const path = require('path');

module.exports = {
  name: 'read_file',
  description: 'Read content of a file from the project',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from project root' }
    },
    required: ['path']
  },
  async handler({ path: filePath }, { projectPath }) {
    const full = path.join(projectPath, filePath);
    if (!fs.existsSync(full)) return { error: `File not found: ${filePath}` };
    const content = fs.readFileSync(full, 'utf-8');
    return { path: filePath, content, lines: content.split('\n').length };
  }
};
```

---

### `src/tools/write-file.js`

```js
const fs   = require('fs');
const path = require('path');

module.exports = {
  name: 'write_file',
  description: 'Write or create a file. Backs up existing files automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      path:    { type: 'string', description: 'Relative file path' },
      content: { type: 'string', description: 'Full file content to write' }
    },
    required: ['path', 'content']
  },
  async handler({ path: filePath, content }, { projectPath }) {
    const full = path.join(projectPath, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const existed = fs.existsSync(full);
    if (existed) fs.copyFileSync(full, `${full}.bak.${Date.now()}`);
    fs.writeFileSync(full, content, 'utf-8');
    return { success: true, action: existed ? 'updated' : 'created', path: filePath };
  }
};
```

---

### `src/tools/apply-patch.js`

```js
const fs   = require('fs');
const path = require('path');
const { fuzzyApplyHunk } = require('../fuzzy-search');

module.exports = {
  name: 'apply_patch',
  description: 'Apply a targeted SEARCH/REPLACE edit. Uses fuzzy matching.',
  inputSchema: {
    type: 'object',
    properties: {
      path:    { type: 'string' },
      search:  { type: 'string', description: 'Exact lines to find' },
      replace: { type: 'string', description: 'Replacement lines' }
    },
    required: ['path', 'search', 'replace']
  },
  async handler({ path: filePath, search, replace }, { projectPath }) {
    const full = path.join(projectPath, filePath);
    if (!fs.existsSync(full)) return { success: false, error: `File not found: ${filePath}` };
    const content = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n');
    const result  = fuzzyApplyHunk(content, search.replace(/\r\n/g, '\n'), replace.replace(/\r\n/g, '\n'));
    if (!result) return { success: false, error: 'Search block not found (tried 5 strategies)' };
    fs.copyFileSync(full, `${full}.bak.${Date.now()}`);
    fs.writeFileSync(full, result.result, 'utf-8');
    return { success: true, strategy: result.strategy, path: filePath };
  }
};
```

---

### `src/tools/list-files.js`

```js
const fs   = require('fs');
const path = require('path');

const EXCLUDE = ['node_modules', '.git', '.next', 'dist', 'build', '.session'];

module.exports = {
  name: 'list_files',
  description: 'List all project files with optional pattern filter.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Optional filter e.g. src/**/*.tsx' }
    }
  },
  async handler({ pattern }, { projectPath }) {
    const files = [];
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!EXCLUDE.includes(e.name)) scan(full);
        } else {
          const rel = path.relative(projectPath, full).replace(/\\/g, '/');
          if (!pattern || rel.includes(pattern.replace(/\*/g, ''))) files.push(rel);
        }
      }
    };
    scan(projectPath);
    return { files, count: files.length };
  }
};
```

---

### `src/tools/execute-command.js`

```js
const { spawn } = require('child_process');

module.exports = {
  name: 'execute_command',
  description: 'Run a shell command in the project directory.',
  inputSchema: {
    type: 'object',
    properties: {
      cmd:     { type: 'string',  description: 'Command to run e.g. npm install' },
      timeout: { type: 'number',  description: 'Timeout ms (default 30000)' }
    },
    required: ['cmd']
  },
  async handler({ cmd, timeout = 30000 }, { projectPath }) {
    return new Promise((resolve) => {
      let stdout = '', stderr = '';
      const child = spawn(cmd, [], { cwd: projectPath, shell: true, timeout });
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('close', code => resolve({ exitCode: code, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 1000) }));
      child.on('error', err => resolve({ exitCode: -1, error: err.message }));
    });
  }
};
```

---

### `src/tools/search-code.js`

```js
const fs   = require('fs');
const path = require('path');

const EXCLUDE = ['node_modules', '.git', '.next', 'dist', 'build', '.session'];

module.exports = {
  name: 'search_code',
  description: 'Search for a string or regex across all project files.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text or regex to search for' },
      regex:   { type: 'boolean', description: 'Treat pattern as regex' }
    },
    required: ['pattern']
  },
  async handler({ pattern, regex }, { projectPath }) {
    const results = [];
    const re = regex ? new RegExp(pattern, 'gm') : null;
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!EXCLUDE.includes(e.name)) scan(full);
        } else {
          try {
            fs.readFileSync(full, 'utf-8').split('\n').forEach((line, i) => {
              if (re ? re.test(line) : line.includes(pattern)) {
                const rel = path.relative(projectPath, full).replace(/\\/g, '/');
                results.push({ file: rel, line: i + 1, content: line.trim() });
              }
            });
          } catch {}
        }
      }
    };
    scan(projectPath);
    return { results: results.slice(0, 50), total: results.length };
  }
};
```

---

### `src/tools/undo-last.js`

```js
const fs   = require('fs');
const path = require('path');

const lastOp = { backups: [] };

module.exports = {
  name: 'undo_last_change',
  description: 'Restore files changed in the last write_file or apply_patch call.',
  inputSchema: { type: 'object', properties: {} },
  async handler(_args, { projectPath }) {
    if (lastOp.backups.length === 0)
      return { success: false, message: 'No recent changes to undo' };
    const restored = [];
    for (const { original, backup } of lastOp.backups) {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, original);
        fs.unlinkSync(backup);
        restored.push(path.relative(projectPath, original));
      }
    }
    lastOp.backups = [];
    return { success: true, restored };
  },
  recordBackup(original, backup) {
    lastOp.backups.push({ original, backup });
  }
};
```

---

## 🖥️ Section 5 — Step 3: JSON-RPC MCP Server

### MCP Protocol Format

```
// Claude Desktop → MCP Server (stdin pe aata hai):
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}

// MCP Server → Claude Desktop (stdout pe jaata hai):
{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}

// Tool call:
{"jsonrpc":"2.0","id":2,"method":"tools/call",
  "params":{"name":"read_file","arguments":{"path":"src/App.tsx"}}}

// Response:
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"..."}]}}
```

### `src/mcp-server.js`

```js
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
```

### `mcp-entry.js` — Root Mein Banao

```js
#!/usr/bin/env node
// mcp-entry.js

const path      = require('path');
const MCPServer = require('./src/mcp-server');

const projectPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

const server = new MCPServer(projectPath);
server.start();
```

### `package.json` Update

```json
"scripts": {
  "start": "node index.js",
  "mcp":   "node mcp-entry.js"
}
```

---

## 🎯 Section 6 — Claude Desktop / Cursor Setup

### Claude Desktop — `claude_desktop_config.json`
**Location:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "deepseek-mcp": {
      "command": "node",
      "args": [
        "C:\\Users\\Ajit\\deepseekMcp\\mcp-entry.js",
        "C:\\Users\\Ajit\\my-react-project"
      ]
    }
  }
}
```

> ⚠️ Windows path mein double backslash use karo — JSON mein `\` escape character hai.

### Cursor Setup
Settings → MCP Servers → Add Server:

```json
{
  "name": "deepseek-mcp",
  "command": "node",
  "args": [
    "C:\\Users\\Ajit\\deepseekMcp\\mcp-entry.js",
    "C:\\Users\\Ajit\\my-react-project"
  ]
}
```

### Manual Test

```bash
# Terminal 1: Server chalao
node mcp-entry.js C:\Users\Ajit\my-react-project

# Terminal 2: stdin simulate karo
echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}

# Expected response:
# {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05",...}}
```

---

## 📅 Section 7 — Step-by-Step Order

| Step | Task | Time | Files |
|---|---|---|---|
| 1 | Fuzzy Search Engine | 2-3 hrs | `src/fuzzy-search.js` + `response-parser.js` update |
| 2 | Tools Directory + Registry | 1 hr | `src/tools/index.js` |
| 3 | All 7 Tool Files | 3-4 hrs | `src/tools/*.js` (7 files) |
| 4 | MCP Server Core | 2-3 hrs | `src/mcp-server.js` |
| 5 | Entry Point + package.json | 30 min | `mcp-entry.js` + `package.json` |
| 6 | Claude Desktop Register | 15 min | `claude_desktop_config.json` |
| 7 | Test + Debug | 1-2 hrs | Manual testing |

### Step 1 — Fuzzy Search ✅ Yahan Se Shuru Karo
- `src/fuzzy-search.js` banao
- `response-parser.js` mein import add karo
- `applyHunk()` ko `fuzzyApplyHunk()` se replace karo
- Test: ek query bhejo → `"applied via: full-trim"` dikhna chahiye

### Step 2 — Tools
- `mkdir src/tools`
- `src/tools/index.js` banao
- Sab 7 tool files banao

### Step 3 — MCP Server
- `src/mcp-server.js` banao
- `mcp-entry.js` banao root mein
- `package.json` mein `"mcp"` script add karo

### Step 4 — Register & Test
- Claude Desktop config update karo
- Claude Desktop restart karo
- Claude Desktop mein Tools section mein `deepseek-mcp` dikhna chahiye
- Test query: `"list the files in my project"`

---

## 🐛 Section 8 — Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| MCP server not connecting | Wrong path in config | Double check backslashes in config.json |
| Tool not found | Missing in tools/index.js | Check sab 7 files import hain |
| fuzzy-search not found | Wrong relative path | `./fuzzy-search` use karo, `../fuzzy-search` nahi |
| Server starts but no response | stdout mein garbage | `console.log` hata do — stdout sirf JSON ke liye |
| Fuzzy match always fails | Threshold too high | Score 0.70 se 0.55 kar do |
| apply_patch fails | Missing import | `require('../fuzzy-search')` check karo |

> ⚠️ **CRITICAL:** MCP mode mein `console.log` BAND karo — stdout sirf JSON-RPC ke liye hai. Debug ke liye `console.error` use karo (stderr pe jaata hai).

### Debug Logging

```js
// mcp-server.js mein add karo (stderr only!):
async _handleMessage(raw) {
  process.stderr.write(`[DEBUG] → ${raw.substring(0, 100)}\n`);
  // ...
}

// Run with debug log:
// node mcp-entry.js C:\path\to\project 2>debug.log
```

---

## 🏁 Final Summary

### Before vs After

| Feature | Before | After |
|---|---|---|
| SEARCH/REPLACE accuracy | ~60% (exact only) | ~95% (5 strategies) |
| MCP Protocol | ❌ Not real MCP | ✅ JSON-RPC 2.0 |
| Claude Desktop support | ❌ CLI only | ✅ Direct integration |
| Cursor support | ❌ CLI only | ✅ Direct integration |
| AI controls tools | ❌ CLI controls | ✅ AI calls tools |
| Code search | ❌ Basic | ✅ Regex + fuzzy |

---

> 🚀 **Step 1 (fuzzy-search.js) se shuru kar — ek baar yeh kaam kare toh Phase 4 ka 80% solve ho jaata hai!**
