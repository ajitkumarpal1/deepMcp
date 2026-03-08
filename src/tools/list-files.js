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
