const fs   = require('fs');
const path = require('path');
const { guardPath } = require('./path-guard');
const undoLast = require('./undo-last');

module.exports = {
  name: 'write_file',
  description: 'Write or create a file. Backs up existing files automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      path:    { type: 'string', description: 'Relative file path from project root' },
      content: { type: 'string', description: 'Full file content to write' }
    },
    required: ['path', 'content']
  },
  async handler({ path: filePath, content }, { projectPath }) {
    let full;
    try {
      full = guardPath(filePath, projectPath);
    } catch (e) {
      return { success: false, error: e.message };
    }

    fs.mkdirSync(path.dirname(full), { recursive: true });
    const existed = fs.existsSync(full);

    if (existed) {
      const backup = `${full}.bak.${Date.now()}`;
      fs.copyFileSync(full, backup);
      undoLast.recordBackup(full, backup);
    }

    fs.writeFileSync(full, content, 'utf-8');
    return { success: true, action: existed ? 'updated' : 'created', path: filePath };
  }
};
