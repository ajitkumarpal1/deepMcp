const fs   = require('fs');
const path = require('path');

module.exports = {
  name: 'read_file',
  description: 'Read content of a file from the project',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from project root' }
    },
    required: ['path']
  },
  async handler({ path: filePath }, { projectPath }) {
    const full = path.join(projectPath, filePath);
    if (!fs.existsSync(full)) return { error: `File not found: ${filePath}` };
    const content = fs.readFileSync(full, 'utf-8');
    return { path: filePath, content, lines: content.split('\n').length };
  }
};
