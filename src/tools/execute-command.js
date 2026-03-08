const { spawn } = require('child_process');
const path       = require('path');
const config     = require('../config');

// Shell metacharacters that enable injection attacks.
// Blocks: command chaining (&&, ;, |), subshell ($(), ``), redirects (< >), etc.
const SHELL_META_RE = /[;&|`$<>(){}!\n\r]/;

module.exports = {
  name: 'execute_command',
  description: 'Run a shell command in the project directory. Only allowlisted commands are permitted.',
  inputSchema: {
    type: 'object',
    properties: {
      cmd:     { type: 'string', description: 'Command to run, e.g. "npm install" or "git status"' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' }
    },
    required: ['cmd']
  },
  async handler({ cmd, timeout = 30000 }, { projectPath }) {
    const trimmed = cmd.trim();
    if (!trimmed) return { exitCode: -1, error: 'Empty command' };

    // Extract the base command name (first word, strip path prefix and extensions)
    const parts  = trimmed.split(/\s+/);
    const binary = path.basename(parts[0]).replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase();

    // Validate against allowlist
    if (!config.ALLOWED_COMMANDS.includes(binary)) {
      return {
        exitCode: -1,
        error: `Command "${binary}" is not in the allowlist. Allowed: ${config.ALLOWED_COMMANDS.join(', ')}. Set ALLOWED_COMMANDS env var to extend.`
      };
    }

    // Block shell injection metacharacters
    if (SHELL_META_RE.test(trimmed)) {
      return {
        exitCode: -1,
        error: 'Command contains forbidden shell characters (&, ;, |, $, `, <, >, (, ), {, }). Use separate tool calls for compound operations.'
      };
    }

    return new Promise((resolve) => {
      let stdout = '', stderr = '';

      // shell:true required for Windows npm.cmd / npx.cmd compatibility.
      // The allowlist + metacharacter filter above make this safe.
      const child = spawn(trimmed, [], {
        cwd:     projectPath,
        shell:   true,
        timeout,
        windowsHide: true,
      });

      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('close',  code => resolve({
        exitCode: code,
        stdout:   stdout.slice(0, 4000),
        stderr:   stderr.slice(0, 1000),
      }));
      child.on('error', err => resolve({ exitCode: -1, error: err.message }));
    });
  }
};
