const fs     = require('fs');
const path   = require('path');
const config = require('../config');

module.exports = {
  name: 'list_files',
  description: 'List all project files with an optional pattern filter.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Optional filter string, e.g. "src/" or ".tsx"' }
    }
  },
  async handler({ pattern } = {}, { projectPath }) {
    const files   = [];
    const EXCLUDE = config.EXCLUDE_DIRS;

    const scan = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }

      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!EXCLUDE.includes(e.name)) scan(full);
        } else {
          const rel = path.relative(projectPath, full).replace(/\\/g, '/');
          if (!pattern || rel.includes(pattern.replace(/\*/g, ''))) {
            files.push(rel);
          }
        }
      }
    };

    scan(projectPath);
    return { files, count: files.length };
  }
};
