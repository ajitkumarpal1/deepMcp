const fs   = require('fs');
const path = require('path');
const { fuzzyApplyHunk } = require('../fuzzy-search');
const undoLast = require('./undo-last');

module.exports = {
  name: 'apply_patch',
  description: 'Apply a targeted SEARCH/REPLACE edit. Uses fuzzy matching.',
  inputSchema: {
    type: 'object',
    properties: {
      path:    { type: 'string' },
      search:  { type: 'string', description: 'Exact lines to find' },
      replace: { type: 'string', description: 'Replacement lines' }
    },
    required: ['path', 'search', 'replace']
  },
  async handler({ path: filePath, search, replace }, { projectPath }) {
    const full = path.join(projectPath, filePath);
    if (!fs.existsSync(full)) return { success: false, error: `File not found: ${filePath}` };
    const content = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n');
    const result  = fuzzyApplyHunk(content, search.replace(/\r\n/g, '\n'), replace.replace(/\r\n/g, '\n'));
    if (!result) return { success: false, error: 'Search block not found (tried 5 strategies)' };
    const backup = `${full}.bak.${Date.now()}`;
    fs.copyFileSync(full, backup);
    undoLast.recordBackup(full, backup);
    fs.writeFileSync(full, result.result, 'utf-8');
    return { success: true, strategy: result.strategy, path: filePath };
  }
};
