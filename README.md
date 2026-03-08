# deepseek-mcp

A dual-mode tool that connects DeepSeek AI to your codebase.

**CLI mode** — Interactive terminal session. Playwright automates the DeepSeek web UI, builds context from your project files, sends your queries, and automatically applies AI-generated code changes via a fuzzy SEARCH/REPLACE engine.

**MCP server mode** — A JSON-RPC 2.0 server ([Model Context Protocol](https://modelcontextprotocol.io)) that exposes 7 file-system and shell tools to Claude Desktop, Cursor, or any MCP-compatible client.

---

## Requirements

- Node.js 18 or later
- Playwright Chromium (CLI mode only)

---

## Installation

```bash
git clone <your-repo-url>
cd deepseekMcp
npm install

# CLI mode only — install Chromium browser
npx playwright install chromium
```

---

## Usage

### CLI Mode

```bash
node index.js /path/to/your/project
```

On first run, a browser window opens to `chat.deepseek.com`. Log in manually, then press Enter in the terminal.

**Available commands at the prompt:**

| Command | Description |
|---|---|
| `<your query>` | Send a query to DeepSeek with your project as context |
| `undo` | Restore the last set of changed files from backup |
| `clean` | Remove orphaned `.bak.*` files from the project |
| `run <cmd>` | Run a shell command in the project directory |
| `multi` | Toggle between same-chat and new-chat-per-query mode |
| `exit` | Close the browser and quit |

**Example:**

```
> add a dark mode toggle to the header component
> undo
> run npm run build
```

### MCP Server Mode

Use this to connect Claude Desktop or Cursor directly to your project.

```bash
node mcp-entry.js /path/to/your/project
```

#### Claude Desktop setup

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deepseek-mcp": {
      "command": "node",
      "args": [
        "C:\\Users\\Ajit\\Desktop\\deepseekMcp\\mcp-entry.js",
        "C:\\path\\to\\your\\project"
      ]
    }
  }
}
```

Restart Claude Desktop. The tools will appear in the Tools section.

#### Cursor setup

Settings → MCP Servers → Add Server:

```json
{
  "name": "deepseek-mcp",
  "command": "node",
  "args": ["C:\\Users\\Ajit\\Desktop\\deepseekMcp\\mcp-entry.js", "C:\\path\\to\\project"]
}
```

### MCP Tools

| Tool | Description |
|---|---|
| `read_file` | Read a file from the project |
| `write_file` | Write or create a file (auto-backs up) |
| `apply_patch` | Apply a SEARCH/REPLACE edit with fuzzy matching |
| `list_files` | List all project files |
| `search_code` | Search for text or regex across files |
| `execute_command` | Run an allowlisted shell command |
| `undo_last_change` | Restore files from the last backup |

---

## Configuration

All values can be overridden via environment variables:

| Variable | Default | Description |
|---|---|---|
| `DEEPSEEK_TIMEOUT_MS` | `300000` | Max wait time for a DeepSeek response (ms) |
| `DEEPSEEK_POLL_MS` | `1500` | Polling interval while waiting for response |
| `MAX_FILE_SIZE_KB` | `100` | Skip files larger than this (KB) |
| `MAX_TOTAL_CHARS` | `80000` | Max characters of context to send |
| `MAX_FILES_PER_QUERY` | `12` | Max files included in a single query |
| `FUZZY_MIN_CONFIDENCE` | `0.70` | Min Jaccard score to apply a fuzzy patch |
| `ALLOWED_COMMANDS` | `npm,npx,yarn,...` | Comma-separated allowlist for `execute_command` |
| `DEEPSEEK_SESSION_PATH` | `~/.deepseek-mcp/session` | Browser session storage location |
| `DEEPSEEK_UNDO_PATH` | `~/.deepseek-mcp/undo-state.json` | Undo state file location |
| `DEBUG` | (unset) | Set to any value to enable debug logging |

---

## How it works

### Fuzzy SEARCH/REPLACE engine

When DeepSeek returns code changes, the engine tries 5 strategies in order:

1. **Exact** — direct string match
2. **Trim-end** — trailing whitespace normalized
3. **Full-trim** — all leading/trailing whitespace stripped (handles indent drift)
4. **Fuzzy (Jaccard)** — token similarity ≥ 70% confidence
5. **Large-hunk fallback** — if SEARCH is >50% of the file, use REPLACE as the new file

### Context selection

For each query, the engine:
1. Extracts keywords from your query
2. Always pins `package.json`, layout files, and any files you explicitly mention
3. Scores remaining files by keyword hits in path and content
4. Sends the top N most relevant files (default 12)

---

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint

# Format
npm run format
```

### Selectors

DeepSeek's web UI CSS classes are externalized in `src/selectors.config.js`. If the UI updates and the tool breaks, update that file — no changes to the browser logic required.

---

## Security

- **Path traversal protection** — All file tools validate that paths stay within the project root.
- **Command allowlist** — `execute_command` only runs approved binaries (`npm`, `git`, `node`, etc.). Override with `ALLOWED_COMMANDS`.
- **Shell injection blocking** — Commands containing `&`, `;`, `|`, `$`, backticks, or redirects are rejected.
- **Session isolation** — The browser session is stored in `~/.deepseek-mcp/session`, not the project directory.

---

## License

MIT
