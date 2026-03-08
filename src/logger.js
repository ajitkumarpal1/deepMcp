/**
 * MCP-safe logger.
 *
 * In MCP mode (MCP_MODE=1), stdout is reserved for JSON-RPC messages.
 * All log output is routed to stderr so it never corrupts the protocol.
 *
 * In CLI mode, output goes to stdout as normal.
 */
const config = require('./config');

const isMcp = config.MCP_MODE;

function write(stream, level, args) {
  const msg = args.map(a =>
    a instanceof Error ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a))
  ).join(' ');
  stream.write(`[${level}] ${msg}\n`);
}

module.exports = {
  /** Structured info — stderr in MCP mode, stdout in CLI mode */
  info:  (...a) => write(isMcp ? process.stderr : process.stdout, 'INFO',  a),
  /** Warnings — always stderr */
  warn:  (...a) => write(process.stderr, 'WARN',  a),
  /** Errors — always stderr */
  error: (...a) => write(process.stderr, 'ERROR', a),
  /** Debug — stderr, only when DEBUG env is set */
  debug: (...a) => { if (process.env.DEBUG) write(process.stderr, 'DEBUG', a); },

  /**
   * User-facing CLI output (emoji strings, formatted tables, etc.).
   * Completely suppressed in MCP mode — never touches stdout/stderr channels.
   */
  cli: (...a) => {
    if (!isMcp) process.stdout.write(a.join(' ') + '\n');
  },
};
