const fs     = require('fs');
const path   = require('path');
const config = require('../config');

module.exports = {
  name: 'search_code',
  description: 'Search for a string or regex pattern across all project files.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Text or regex pattern to search for' },
      regex:   { type: 'boolean', description: 'Treat pattern as a regular expression' }
    },
    required: ['pattern']
  },
  async handler({ pattern, regex }, { projectPath }) {
    // Validate regex before scanning — malformed patterns crash the process
    let re = null;
    if (regex) {
      try {
        re = new RegExp(pattern, 'gm');
      } catch (e) {
        return { error: `Invalid regular expression: ${e.message}` };
      }
    }

    const results = [];
    const EXCLUDE = config.EXCLUDE_DIRS;

    const scan = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }

      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!EXCLUDE.includes(e.name)) scan(full);
          continue;
        }
        try {
          const text = fs.readFileSync(full, 'utf-8');
          text.split('\n').forEach((line, i) => {
            // Reset lastIndex for stateful global regexes
            if (re) re.lastIndex = 0;
            const hit = re ? re.test(line) : line.includes(pattern);
            if (hit) {
              const rel = path.relative(projectPath, full).replace(/\\/g, '/');
              results.push({ file: rel, line: i + 1, content: line.trim() });
            }
          });
        } catch { /* skip unreadable files */ }
      }
    };

    scan(projectPath);
    return { results: results.slice(0, 50), total: results.length };
  }
};
