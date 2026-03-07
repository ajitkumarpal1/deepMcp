# DeepSeek MCP Layer — Full Roadmap to Real MCP Behavior

## Current State (What Works Today)

```
User types query
     |
context-builder  →  scores + selects relevant files  →  builds prompt
     |
deepseek-browser →  sends via Playwright browser automation
     |
response-parser  →  detects SEARCH/REPLACE or full-file blocks
     |
orchestrator     →  applies patches, undo, backup, clean
```

**What it does well:** Smart file selection, patch-based editing, two-way context loop, auto file-reading.

**What it cannot do:** Auto-run commands, generate files in chunks, scaffold projects, work as a real MCP server connectable from Claude Desktop / Cursor / VS Code.

---

## What "Real MCP" Actually Means

A real MCP (Model Context Protocol) server works like this:

```
AI (Claude / GPT / DeepSeek)
     |
     |  "I want to call tool: write_file('src/App.jsx', '...')"
     v
MCP Server receives the tool call
     |
     |  executes: writes the file to disk
     v
Returns result to AI: "File written successfully"
     |
     v
AI decides next action: "Now call tool: execute_command('npm install')"
     |
     v
MCP Server executes npm install, streams output back to AI
     |
     v
AI sees output, decides next step...
```

The AI is IN CONTROL of the loop. It calls tools. The MCP layer just executes them.

Current project is the OPPOSITE — the MCP layer controls the loop and the AI just responds. That is why it cannot do "one prompt -> full project" reliably.

---

## The 5 Phases

---

## Phase 1 — Auto-Run Commands After Apply (Easy, High Value)

**Problem:** User applies files then manually types `run npm install`. Should be automatic.

**What to build:**

### 1A. Smart post-apply command detection

After files are applied, `orchestrator.js` checks what changed:

- `package.json` created or modified → suggest `npm install`
- Any new file in root → suggest relevant dev command
- Detect framework from `package.json` dependencies:

```js
// src/post-apply-runner.js  (NEW FILE)

const FRAMEWORK_COMMANDS = {
  "next": { install: "npm install", dev: "npm run dev", build: "npm run build" },
  "vite": { install: "npm install", dev: "npm run dev", build: "npm run build" },
  "react-scripts": { install: "npm install", dev: "npm start", build: "npm run build" },
  "nuxt": { install: "npm install", dev: "npm run dev" },
  "express": { install: "npm install", dev: "node index.js" },
};

function detectFramework(projectPath) {
  // reads package.json, returns framework name or null
}

function suggestCommands(appliedChanges, projectPath) {
  // returns array of suggested commands based on what changed
  // e.g. ["npm install", "npm run dev"]
}
```

### 1B. Auto-prompt in orchestrator after apply

```
Applied 5 files.

Detected: Next.js project
Suggested commands:
  1) npm install
  2) npm run dev
  3) skip

Run which? (1/2/3/Enter to skip):
```

If user picks 1 → runs `npm install` in project dir, streams output.
If user picks 2 → runs `npm run dev` (or whichever dev command).

### Files to create/change:
| File | Change |
|---|---|
| `src/post-apply-runner.js` | NEW — framework detector + command suggester |
| `src/orchestrator.js` | After `apply()`, call `postApplyRunner.suggest()` |

### Effort: 1-2 hours
### Unlocks: True "create project → auto install → auto run" flow

---

## Phase 2 — Chunked Output (Multi-Turn File Generation)

**Problem:** AI hits response length limit mid-way through creating a project. The tool has no way to say "continue, give me the rest of the files."

**What to build:**

### 2A. Continuation signal detection

After applying files, check if the AI's response contains signals that there are more files coming:

```js
// src/response-parser.js  (ADD METHOD)

hasContinuationSignal(response) {
  const signals = [
    "i'll continue", "next i'll create", "remaining files",
    "here are the rest", "continuing with", "more files to add",
    "let me also create", "additionally", "i'll now create",
  ];
  return signals.some(s => response.toLowerCase().includes(s));
}
```

### 2B. Continuation loop in orchestrator

After applying a batch of files, if continuation signal detected:

```
Applied 3 files.

AI may have more files to create. Continue? (y/Enter to skip):
```

If yes → send follow-up in SAME chat:
```
"Those files were applied successfully.
Please continue and provide the remaining files in the same SEARCH/REPLACE or full-file format."
```

Repeat until no more continuation signals.

### 2C. Chunked generation prompt addition

Add to `context-builder.js` prompt instructions:

```
If you need to create many files, you can split across messages.
After each batch, say "I'll continue with more files..."
and I will ask you to continue.
```

### Files to create/change:
| File | Change |
|---|---|
| `src/response-parser.js` | Add `hasContinuationSignal()` method |
| `src/orchestrator.js` | After apply, check signal → loop continuation |
| `src/context-builder.js` | Add chunked generation note to prompt |

### Effort: 2-3 hours
### Unlocks: Full project generation across multiple responses

---

## Phase 3 — Project Scaffolding (Framework Bootstrap)

**Problem:** "Create a Next.js app" → the AI would need to write 20+ boilerplate files. Better to scaffold first, then let AI modify.

**What to build:**

### 3A. Intent detection

```js
// src/intent-detector.js  (NEW FILE)

const SCAFFOLD_PATTERNS = [
  { pattern: /new (next\.?js|nextjs)/i, cmd: "npx create-next-app@latest {name} --typescript --tailwind --app" },
  { pattern: /new (react|vite.*react)/i, cmd: "npm create vite@latest {name} -- --template react-ts" },
  { pattern: /new vue/i, cmd: "npm create vue@latest {name}" },
  { pattern: /new express/i, cmd: "npm init -y && npm install express" },
  { pattern: /new (node|nodejs)/i, cmd: "npm init -y" },
];

function detectScaffoldIntent(query) {
  // returns { cmd, name } or null
}
```

### 3B. Scaffold flow in orchestrator

```
> create a new Next.js app with dark mode and product listing

Detected: New Next.js project scaffold
Project name: (enter name or press Enter for "my-app"): my-shop

Running: npx create-next-app@latest my-shop --typescript --tailwind --app
[... scaffold output streams ...]

Scaffold complete! Now sending your task to DeepSeek with the scaffolded project context...
```

After scaffold → `contextBuilder.scan()` on the new folder → normal query flow.

### Files to create/change:
| File | Change |
|---|---|
| `src/intent-detector.js` | NEW — scaffold intent detection |
| `src/orchestrator.js` | Check intent before `_processQuery()`, run scaffold |

### Effort: 3-4 hours
### Unlocks: True "one prompt → working project" experience

---

## Phase 4 — Real MCP Protocol Server (The Big One)

**Problem:** This tool only works as a standalone CLI. A real MCP server can be connected from Claude Desktop, Cursor, VS Code — the AI calls tools directly.

**What to build:**

### 4A. Architecture shift

Instead of "MCP controls loop, AI just responds," flip it:

```
AI (Claude via API / DeepSeek via API)
     |
     |  tool_call: { name: "read_file", args: { path: "src/app/page.tsx" } }
     v
MCP Server (stdio)
     |  reads file, returns content
     v
AI receives file content, decides next tool call
     |
     |  tool_call: { name: "write_file", args: { path: "...", content: "..." } }
     v
MCP Server writes file, returns "success"
     |
     v
AI: tool_call: { name: "execute_command", args: { cmd: "npm install" } }
     |
     v
MCP Server runs command, streams output back
     |
     v
AI: "Done! Your app is running."
```

### 4B. Tools to expose

```js
// src/mcp-server.js  (NEW FILE)

const TOOLS = [
  {
    name: "read_file",
    description: "Read a file from the project",
    inputSchema: { path: "string" },
    handler: (args) => fs.readFileSync(resolve(args.path), "utf-8"),
  },
  {
    name: "write_file",
    description: "Write or create a file in the project",
    inputSchema: { path: "string", content: "string" },
    handler: (args) => { /* backup + write */ },
  },
  {
    name: "apply_patch",
    description: "Apply a targeted SEARCH/REPLACE edit to a file",
    inputSchema: { path: "string", search: "string", replace: "string" },
    handler: (args) => { /* patch logic from response-parser */ },
  },
  {
    name: "list_files",
    description: "List files matching a pattern in the project",
    inputSchema: { pattern: "string" },
    handler: (args) => glob(args.pattern),
  },
  {
    name: "execute_command",
    description: "Run a shell command in the project directory",
    inputSchema: { cmd: "string" },
    handler: (args) => spawnAndCapture(args.cmd),
  },
  {
    name: "search_code",
    description: "Search for a pattern across all project files",
    inputSchema: { pattern: "string" },
    handler: (args) => grepProject(args.pattern),
  },
  {
    name: "undo_last_change",
    description: "Restore files from the last backup",
    handler: () => parser.restoreBackups(lastChanges),
  },
];
```

### 4C. Transport options

**Option A — stdio (for Claude Desktop / Cursor / VS Code)**

```js
// Standard MCP stdio transport
process.stdin.on("data", (chunk) => {
  const request = JSON.parse(chunk);
  const result = handleToolCall(request);
  process.stdout.write(JSON.stringify(result) + "\n");
});
```

Register in Claude Desktop `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "deepseek-mcp": {
      "command": "node",
      "args": ["C:/path/to/deepseekMcp/mcp-server.js", "C:/path/to/your-project"]
    }
  }
}
```

**Option B — HTTP/SSE (for web clients)**

```js
const express = require("express");
app.post("/tools/:name", async (req, res) => {
  const result = await handleToolCall(req.params.name, req.body);
  res.json(result);
});
```

### 4D. AI backend options once on real MCP

| Backend | Cost | Quality | How |
|---|---|---|---|
| DeepSeek API | ~$0.14/M tokens | Excellent | `fetch` to api.deepseek.com |
| Claude API | Pay per token | Best | Anthropic SDK |
| Ollama local | Free | Good (small models) | `fetch` to localhost:11434 |
| DeepSeek Browser | Free | Excellent | Current Playwright approach |

The MCP server can support ALL of these as swappable backends.

### Files to create/change:
| File | Change |
|---|---|
| `src/mcp-server.js` | NEW — full MCP stdio/HTTP server |
| `src/tools/*.js` | NEW — individual tool handlers |
| `mcp-entry.js` | NEW — entry point for MCP mode |
| `index.js` | Add `--mcp` flag to launch in MCP mode |

### Effort: 1-2 weeks
### Unlocks: Connectable from Claude Desktop, Cursor, VS Code. AI controls the loop.

---

## Phase 5 — Production Polish

### 5A. Git integration

After applying changes, auto-commit:

```
Applied 3 files.
Auto-commit? (y/n): y
[git add + git commit -m "feat: dark mode on products page"]
```

```js
// src/git-manager.js  (NEW FILE)
function autoCommit(appliedFiles, message) {
  exec(`git add ${appliedFiles.join(" ")} && git commit -m "${message}"`);
}
```

### 5B. Diff view before applying

Instead of just showing "PATCH globals.css (2 hunks)", show an actual diff:

```diff
src/app/globals.css
  --background: oklch(1 0 0);          // removed
+ --background: oklch(0.18 0 0);       // added (dark)
  --foreground: oklch(0.145 0 0);      // removed
+ --foreground: oklch(0.985 0 0);      // added
```

```js
// src/diff-viewer.js  (NEW FILE)
function renderDiff(search, replace) {
  // line-by-line diff using built-in string comparison
  // no external library needed
}
```

### 5C. Session restore

Save the last session state (which project, which files changed) to `.deepseek-mcp-session.json`. On restart, offer to continue from where you left off.

### 5D. `.env` support for API key

When the user eventually wants to switch from browser to DeepSeek API:

```
DEEPSEEK_API_KEY=sk-...
BACKEND=api  # or "browser"
MAX_CONTEXT_FILES=12
```

```js
// src/config.js  (NEW FILE)
const config = {
  backend: process.env.BACKEND || "browser",
  apiKey: process.env.DEEPSEEK_API_KEY || null,
  maxContextFiles: parseInt(process.env.MAX_CONTEXT_FILES) || 12,
};
```

### Effort: 3-5 days
### Unlocks: Production-grade reliability, git safety, better UX

---

## Implementation Priority

```
NOW (do first — easy wins, high value)
  Phase 1 — Auto-run after apply         1-2 hours
  Phase 2 — Chunked output loop          2-3 hours

NEXT (medium effort, big unlock)
  Phase 3 — Project scaffolding          3-4 hours
  Phase 5A — Git integration             1-2 hours
  Phase 5B — Diff view                   2-3 hours

LATER (large effort, architectural change)
  Phase 4 — Real MCP protocol server     1-2 weeks

OPTIONAL
  Phase 5C — Session restore
  Phase 5D — .env / API key support
```

---

## File Structure After All Phases

```
deepseekMcp/
├── index.js                      ← CLI entry (current mode)
├── mcp-entry.js                  ← MCP server entry (Phase 4)
├── package.json
├── .env                          ← API keys, config (Phase 5D)
├── .gitignore
├── src/
│   ├── orchestrator.js           ← main loop (updated each phase)
│   ├── context-builder.js        ← smart file selection (DONE)
│   ├── deepseek-browser.js       ← Playwright automation (DONE)
│   ├── response-parser.js        ← patch + full write (DONE)
│   ├── post-apply-runner.js      ← Phase 1 (NEW)
│   ├── intent-detector.js        ← Phase 3 (NEW)
│   ├── mcp-server.js             ← Phase 4 (NEW)
│   ├── diff-viewer.js            ← Phase 5B (NEW)
│   ├── git-manager.js            ← Phase 5A (NEW)
│   ├── config.js                 ← Phase 5D (NEW)
│   └── tools/                   ← Phase 4 (NEW DIR)
│       ├── read-file.js
│       ├── write-file.js
│       ├── apply-patch.js
│       ├── list-files.js
│       ├── execute-command.js
│       └── search-code.js
└── logs/                         ← AI responses (auto-created)
```

---

## The Gap Between "Current" and "Real MCP Claude Code"

| Feature | Current | After Phase 1+2 | After Phase 3+4 |
|---|---|---|---|
| Edit existing files | Yes (patch) | Yes | Yes |
| Create new files | Yes | Yes | Yes |
| Auto-run npm install | No | **Yes** | Yes |
| Generate large projects in chunks | No | **Yes** | Yes |
| Scaffold new framework projects | No | No | **Yes** |
| AI controls the tool loop | No | No | **Yes** |
| Connectable from Claude Desktop | No | No | **Yes** |
| Connectable from Cursor | No | No | **Yes** |
| Works without browser open | No | No | **Yes (with API)** |
| Diff view before applying | No | No | **Yes** |
| Git auto-commit | No | No | **Yes** |

The single biggest architectural difference from Claude Code is **Phase 4** — in Claude Code, the AI calls tools. In this project, the MCP layer calls the AI. Phases 1-3 are improvements within the current architecture. Phase 4 is the real shift.

---

## Quick Start — Implementing Phase 1 First

Phase 1 (`post-apply-runner.js`) is the best starting point:
- Highest immediate value
- Lowest risk (only runs after user confirms apply)
- No architectural change
- Solves the most common complaint: "I applied the files but now I have to manually run npm install"

Start here, then Phase 2, then 3. Phase 4 is its own project.
