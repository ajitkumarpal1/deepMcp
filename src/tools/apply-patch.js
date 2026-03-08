const fs   = require('fs');
const path = require('path');
const { fuzzyApplyHunk } = require('../fuzzy-search');
const { guardPath }      = require('./path-guard');
const undoLast           = require('./undo-last');

module.exports = {
  name: 'apply_patch',
  description: 'Apply a targeted SEARCH/REPLACE edit to an existing file. Uses fuzzy matching.',
  inputSchema: {
    type: 'object',
    properties: {
      path:    { type: 'string', description: 'Relative file path from project root' },
      search:  { type: 'string', description: 'Exact lines to find (will be replaced)' },
      replace: { type: 'string', description: 'Replacement lines' }
    },
    required: ['path', 'search', 'replace']
  },
  async handler({ path: filePath, search, replace }, { projectPath }) {
    let full;
    try {
      full = guardPath(filePath, projectPath);
    } catch (e) {
      return { success: false, error: e.message };
    }

    if (!fs.existsSync(full)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    const content = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n');
    const result  = fuzzyApplyHunk(
      content,
      search.replace(/\r\n/g, '\n'),
      replace.replace(/\r\n/g, '\n')
    );

    if (!result) {
      return { success: false, error: 'Search block not found (tried 5 strategies)' };
    }

    const backup = `${full}.bak.${Date.now()}`;
    fs.copyFileSync(full, backup);
    undoLast.recordBackup(full, backup);
    fs.writeFileSync(full, result.result, 'utf-8');

    return { success: true, strategy: result.strategy, path: filePath };
  }
};
