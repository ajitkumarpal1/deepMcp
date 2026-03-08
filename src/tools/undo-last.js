const fs   = require('fs');
const path = require('path');

const lastOp = { backups: [] };

module.exports = {
  name: 'undo_last_change',
  description: 'Restore files changed in the last write_file or apply_patch call.',
  inputSchema: { type: 'object', properties: {} },
  async handler(_args, { projectPath }) {
    if (lastOp.backups.length === 0)
      return { success: false, message: 'No recent changes to undo' };
    const restored = [];
    for (const { original, backup } of lastOp.backups) {
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, original);
        fs.unlinkSync(backup);
        restored.push(path.relative(projectPath, original));
      }
    }
    lastOp.backups = [];
    return { success: true, restored };
  },
  recordBackup(original, backup) {
    lastOp.backups.push({ original, backup });
  }
};
