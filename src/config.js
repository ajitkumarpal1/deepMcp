/**
 * Central configuration — all magic numbers and tuneable values live here.
 * Override any value via environment variable.
 */
const path = require('path');
const os   = require('os');

module.exports = {
  // ── Context builder ────────────────────────────────────────────────────────
  MAX_FILE_SIZE_KB:    parseInt(process.env.MAX_FILE_SIZE_KB   || '100',    10),
  MAX_TOTAL_CHARS:     parseInt(process.env.MAX_TOTAL_CHARS    || '80000',  10),
  MAX_FILES_PER_QUERY: parseInt(process.env.MAX_FILES_PER_QUERY|| '12',     10),

  // ── DeepSeek browser ───────────────────────────────────────────────────────
  RESPONSE_TIMEOUT_MS: parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '300000', 10),
  POLL_INTERVAL_MS:    parseInt(process.env.DEEPSEEK_POLL_MS    || '1500',   10),

  // ── Fuzzy matching ─────────────────────────────────────────────────────────
  FUZZY_MIN_CONFIDENCE: parseFloat(process.env.FUZZY_MIN_CONFIDENCE || '0.70'),
  LARGE_HUNK_RATIO:     parseFloat(process.env.LARGE_HUNK_RATIO     || '0.50'),

  // ── Storage paths (outside project root) ──────────────────────────────────
  SESSION_PATH: process.env.DEEPSEEK_SESSION_PATH
    || path.join(os.homedir(), '.deepseek-mcp', 'session'),

  UNDO_STATE_PATH: process.env.DEEPSEEK_UNDO_PATH
    || path.join(os.homedir(), '.deepseek-mcp', 'undo-state.json'),

  // ── Logging ────────────────────────────────────────────────────────────────
  // Set automatically by mcp-entry.js; controls whether stdout is reserved for JSON-RPC
  MCP_MODE: process.env.MCP_MODE === '1',

  // ── Security: shell command allowlist ─────────────────────────────────────
  // Extend via: ALLOWED_COMMANDS=npm,yarn,git,node,tsc
  ALLOWED_COMMANDS: (
    process.env.ALLOWED_COMMANDS ||
    'npm,npx,yarn,pnpm,git,node,tsc,eslint,prettier,jest,vitest,next,vite,react-scripts,bun'
  ).split(',').map(s => s.trim()).filter(Boolean),

  // ── Shared exclude directories ─────────────────────────────────────────────
  EXCLUDE_DIRS: [
    'node_modules', '.git', '.next', 'dist', 'build',
    '.cache', 'coverage', '.session',
  ],
};
