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
