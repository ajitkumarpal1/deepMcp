const fs     = require('fs');
const path   = require('path');
const config = require('../config');

const STATE_FILE = config.UNDO_STATE_PATH;

function loadBackups() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      return Array.isArray(data.backups) ? data.backups : [];
    }
  } catch { /* ignore corrupt state */ }
  return [];
}

function saveBackups(backups) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ backups, savedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  } catch { /* non-fatal */ }
}

function clearState() {
  saveBackups([]);
}

module.exports = {
  name: 'undo_last_change',
  description: 'Restore files changed in the last write_file or apply_patch call. Works across server restarts.',
  inputSchema: { type: 'object', properties: {} },

  async handler(_args, { projectPath }) {
    const backups = loadBackups();
    if (backups.length === 0) {
      return { success: false, message: 'No recent changes to undo' };
    }

    const restored = [];
    for (const { original, backup } of backups) {
      try {
        if (fs.existsSync(backup)) {
          fs.copyFileSync(backup, original);
          fs.unlinkSync(backup);
          restored.push(path.relative(projectPath, original).replace(/\\/g, '/'));
        }
      } catch (e) {
        process.stderr.write(`[undo] Failed to restore ${original}: ${e.message}\n`);
      }
    }

    clearState();
    return { success: true, restored };
  },

  /** Called by write-file and apply-patch after each successful backup. */
  recordBackup(original, backup) {
    const current = loadBackups();
    current.push({ original, backup });
    saveBackups(current);
  },
};
