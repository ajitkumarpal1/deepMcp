const fs   = require('fs');
const path = require('path');

const EXCLUDE = ['node_modules', '.git', '.next', 'dist', 'build', '.session'];

module.exports = {
  name: 'search_code',
  description: 'Search for a string or regex across all project files.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text or regex to search for' },
      regex:   { type: 'boolean', description: 'Treat pattern as regex' }
    },
    required: ['pattern']
  },
  async handler({ pattern, regex }, { projectPath }) {
    const results = [];
    const re = regex ? new RegExp(pattern, 'gm') : null;
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!EXCLUDE.includes(e.name)) scan(full);
        } else {
          try {
            const text = fs.readFileSync(full, 'utf-8');
            text.split('\n').forEach((line, i) => {
              const matches = re ? line.match(re) : (line.includes(pattern) ? [line] : null);
              if (matches && matches.length > 0) {
                const rel = path.relative(projectPath, full).replace(/\\/g, '/');
                results.push({ file: rel, line: i + 1, content: line.trim() });
              }
            });
          } catch {}
        }
      }
    };
    scan(projectPath);
    return { results: results.slice(0, 50), total: results.length };
  }
};
