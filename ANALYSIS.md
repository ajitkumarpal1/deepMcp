# DeepSeek MCP Layer — Complete Project Analysis

## What Is This Project?

This is a **study/learning project** — a CLI tool that uses Playwright to automate the DeepSeek browser chat UI, reads your codebase, sends it as context to DeepSeek, and writes the AI's suggested file changes back to disk.

It is **NOT a real MCP (Model Context Protocol) server**. A real MCP server uses JSON-RPC over stdio/SSE and integrates with Claude Desktop, Cursor, or VS Code. This project is a standalone CLI that mimics the idea.

---

## Project File Structure

```
deepseekMcp/
├── index.js                  ← Entry point (EXISTS, complete)
├── package.json              ← Dependencies declared
├── ALL_FILES.md              ← Old reference/blueprint (older versions of files)
├── src/
│   ├── orchestrator.js       ← Main loop + user prompts
│   ├── deepseek-browser.js   ← Playwright browser automation
│   ├── context-builder.js    ← Reads project files, builds prompt
│   └── response-parser.js    ← Parses AI response, writes files
├── node_modules/             ← playwright installed
└── logs/                     ← (created at runtime) AI responses saved here
```

---

## What It CAN Do (Working Features)

| Feature | Status | Where |
|---|---|---|
| Read project files | YES | `context-builder.js` |
| Write / create files | YES | `response-parser.js` |
| Backup files before overwriting | YES | `response-parser.js` (timestamped `.bak`) |
| Undo last changes | YES | `orchestrator.js` + `response-parser.js` |
| Dry run (preview without applying) | YES | `orchestrator.js` |
| Save AI responses to logs | YES | `orchestrator.js` |
| Respect `.gitignore` patterns | YES | `context-builder.js` |
| Skip large files (>100KB) | YES | `context-builder.js` |
| Limit context to 80,000 chars | YES | `context-builder.js` |
| File tree in prompt | YES | `context-builder.js` |
| Priority ordering (entry files first) | YES | `context-builder.js` |
| Continue button auto-click | YES | `deepseek-browser.js` |
| Persistent browser session (cookies) | YES | Playwright `launchPersistentContext` |

---

## What It CANNOT Do (Missing Features)

### 1. Run Terminal Commands
**Status: NOT IMPLEMENTED**

The project has zero usage of `child_process`, `exec`, `spawn`, or any shell execution. It cannot:
- Run `npm install`
- Run `npm start` or `npm run dev`
- Execute any script it creates
- Run Python files, shell scripts, etc.

If DeepSeek generates a bash script, the tool can **write** that file to disk but cannot **run** it.

---

### 2. Create and Execute Scripts
**Status: PARTIALLY IMPLEMENTED**

- Can **create** script files (`.js`, `.py`, `.sh`, etc.) by writing them to disk.
- Cannot **execute** them — there is no code to run scripts after creation.

---

### 3. Real MCP Protocol Compliance
**Status: NOT IMPLEMENTED**

A proper MCP server must:
- Expose tools, resources, and prompts via JSON-RPC 2.0
- Run as a stdio or SSE transport server
- Be registered and connected from Claude Desktop / Cursor / VS Code

This project does **none** of that. It is a self-contained CLI loop, not an MCP-compatible server.

---

### 4. Multi-Turn Conversation Memory
**Status: NOT IMPLEMENTED**

Every query starts a **brand new DeepSeek chat** (via `_startNewChat()` which navigates to `chat.deepseek.com` fresh). There is no conversation history carried between queries within a session.

---

### 5. Partial File Edits (Diff/Patch)
**Status: NOT IMPLEMENTED**

When AI suggests a change, the parser always **replaces the entire file content**. It cannot apply a diff/patch to only change specific lines.

---

## Bugs and Issues Found

### Bug 1 — DOM Selectors Are Guessed (HIGH RISK)
**File:** `src/deepseek-browser.js`

The selectors used to detect when DeepSeek finishes responding are guessed, not verified:

```js
// These may NOT match DeepSeek's actual DOM:
'[aria-label="Stop"]'           // Stop button
'.ds-markdown'                   // Response content
'[class*="markdown"]'           // Fallback
'button:has-text("Continue")'   // Continue button
```

If DeepSeek updates their UI (which happens frequently), the tool will silently fail or return empty responses.

**Fix needed:** Open DeepSeek in browser, press F12, send a message, and verify the actual selectors.

---

### Bug 2 — Missing `index.js` in ALL_FILES.md vs Actual Code
**File:** `ALL_FILES.md` vs `src/` directory

`ALL_FILES.md` contains **older versions** of all four source files. For example:
- `ALL_FILES.md` version of `deepseek-browser.js` has no Stop button detection
- `src/deepseek-browser.js` (actual running code) has Stop button + smart polling + continue button

The `ALL_FILES.md` is a leftover reference document. The actual code in `src/` is newer and better. There is no conflict at runtime since `index.js` uses `src/` files.

---

### Bug 3 — Backup File Leakage
**File:** `src/response-parser.js:85-88`

```js
const backupPath = `${fullPath}.bak.${Date.now()}`;
fs.copyFileSync(fullPath, backupPath);
```

Backups are created with timestamps but are **never auto-deleted** after undo. Each session leaves `.bak.{timestamp}` files in your project directory permanently unless manually cleaned up.

---

### Bug 4 — Logs Directory Not Guaranteed to Exist
**File:** `src/orchestrator.js:89-90`

```js
const logsDir = path.join(__dirname, "../logs");
fs.mkdirSync(logsDir, { recursive: true });
```

This is actually fine in the current `src/orchestrator.js`. But if you look at the version in `ALL_FILES.md`, it directly calls `writeFileSync` without creating the directory first — that version would crash on first run if `logs/` doesn't exist.

---

### Bug 5 — Windows Path Separator in Response Parser Patterns
**File:** `src/response-parser.js:19-25`

The regex patterns to detect file paths from AI responses use `[\w/.\\\-]+` which handles both forward and backslashes. However, AI models (including DeepSeek) almost always respond with forward slashes (`src/components/App.tsx`). The `normalizePathToOs()` function converts them to OS separators for writing, which is correct. This works on Windows.

---

### Bug 6 — No `.gitignore` File Present
**Status:** The `.session/` folder (which holds Playwright's Chromium profile, cookies, login session) has **no `.gitignore`** to prevent it from being accidentally committed to git.

If you `git init` and `git add .`, you would commit your DeepSeek login session cookies.

---

### Bug 7 — `_waitForLogin()` Conflict with readline
**File:** `src/deepseek-browser.js:63-67`

```js
async _waitForLogin() {
  await new Promise((resolve) => {
    process.stdin.once("data", resolve);  // <-- raw stdin listener
  });
}
```

The `orchestrator.js` creates a `readline` interface on `process.stdin`. When `_waitForLogin()` also listens on `process.stdin` directly via `once("data")`, this can cause a conflict — the readline interface may consume the keypress before the raw listener fires.

---

## Completeness Score by Category

| Category | Completeness | Notes |
|---|---|---|
| File reading | 9/10 | Good, respects gitignore, size limits |
| File writing | 8/10 | Works, but no diff/patch support |
| File backup + undo | 8/10 | Works, but backups never auto-cleaned |
| Browser automation | 6/10 | DOM selectors unverified, may break |
| Response parsing | 7/10 | Multiple patterns, handles edge cases |
| Terminal execution | 0/10 | Not implemented at all |
| Script creation + run | 2/10 | Creates files, cannot execute them |
| Real MCP protocol | 0/10 | Not a real MCP server |
| Multi-turn chat | 0/10 | Each query resets chat |
| Error recovery | 4/10 | Basic try/catch only |
| Session persistence | 8/10 | Playwright persistent context works |

**Overall: ~50% complete** for a "full coding assistant" experience

---

## What Needs to Be Added to Make It More Complete

### Priority 1 — Terminal Execution
Add `child_process` support so the AI can suggest and run commands:

```js
const { exec } = require("child_process");
// After applying changes, optionally run: npm install, npm run build, etc.
```

### Priority 2 — Verify DeepSeek DOM Selectors
Open DeepSeek, press F12, send a heavy message, and find:
1. The element that exists WHILE generating (Stop button)
2. The element with the final response text
3. The Continue button selector (if truncated)

### Priority 3 — Add `.gitignore`
```
.session/
logs/
*.bak.*
node_modules/
```

### Priority 4 — Backup Cleanup
After successful undo, delete the `.bak.{timestamp}` files. Or add a `cleanBackups()` command.

### Priority 5 — Fix stdin Conflict in `_waitForLogin()`
Pass the readline interface or use a different mechanism to wait for Enter press that doesn't conflict with readline.

---

## How to Run

```bash
# Install dependencies (already done — node_modules exists)
npm install

# Install Chromium (needed once)
npx playwright install chromium

# Run pointing at any project
node index.js C:\Users\Ajit\Desktop\my-react-app

# Or run in current directory
node index.js
```

**Commands during runtime:**
- Type any query → sends to DeepSeek with full codebase context
- `y` → apply file changes
- `n` → skip changes (response saved in logs/)
- `dry` → preview what would change without writing
- `undo` → restore files from last backup
- `exit` → quit

---

## Summary

This project is a **functional browser-automation coding assistant** for study purposes. It reads files, passes your entire codebase to DeepSeek, and can write AI-suggested changes back to disk with backup and undo support. The core flow works.

It is **not** a real MCP server, **cannot** run terminal commands, and the DeepSeek DOM selectors need manual verification before the browser automation will work reliably. Once the selectors are confirmed via browser DevTools, the system becomes usable.
