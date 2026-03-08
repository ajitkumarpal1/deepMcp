const fs   = require('fs');
const path = require('path');
const { guardPath } = require('./path-guard');

module.exports = {
  name: 'read_file',
  description: 'Read content of a file from the project.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from project root' }
    },
    required: ['path']
  },
  async handler({ path: filePath }, { projectPath }) {
    let full;
    try {
      full = guardPath(filePath, projectPath);
    } catch (e) {
      return { error: e.message };
    }

    if (!fs.existsSync(full)) return { error: `File not found: ${filePath}` };
    const content = fs.readFileSync(full, 'utf-8');
    return { path: filePath, content, lines: content.split('\n').length };
  }
};
