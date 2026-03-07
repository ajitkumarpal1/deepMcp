const fs = require("fs");
const path = require("path");

const EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  "coverage",
  ".session",
];

function normalizePathToOs(relativePath) {
  return relativePath.trim().replace(/\//g, path.sep);
}

class ResponseParser {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this._lastBackupPaths = {};
  }

  parse(response) {
    const fileMap = {}; // filePath -> change object

    // 1. SEARCH/REPLACE blocks — for editing existing files
    // ### path/to/file.js
    // <<<<<<< SEARCH
    // [exact code to find]
    // =======
    // [replacement code]
    // >>>>>>> REPLACE
    // Handles all format variations DeepSeek uses:
    // - ### prefix optional
    // - blank lines allowed between filename and <<<<<<< SEARCH
    // - closing marker: ">>>>>>> REPLACE" OR just "REPLACE" (DeepSeek often omits >>>>>>>)
    // - blank lines allowed before closing marker
    const srPattern = /(?:###\s+)?([\w/.\\\- ]+\.\w+)\n+\s*<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n+(?:>>>>>>> )?REPLACE/g;
    let match;
    while ((match = srPattern.exec(response)) !== null) {
      const filePath = normalizePathToOs(match[1]);
      const search = match[2];
      const replace = match[3];
      if (!fileMap[filePath]) {
        fileMap[filePath] = { filePath, type: "patch", hunks: [] };
      }
      if (fileMap[filePath].type === "patch") {
        fileMap[filePath].hunks.push({ search, replace });
      }
    }

    // 2. Full file blocks — for new files (or fallback if AI sends full content anyway)
    const fullPatterns = [
      /###\s+([\w/.\\\-]+\.\w+)\s*\n```[\w]*\n([\s\S]*?)```/g,
      /\*\*([\w/.\\\-]+\.\w+)\*\*\s*\n```[\w]*\n([\s\S]*?)```/g,
      /`([\w/.\\\-]+\.\w+)`\s*\n```[\w]*\n([\s\S]*?)```/g,
    ];
    for (const pattern of fullPatterns) {
      while ((match = pattern.exec(response)) !== null) {
        const filePath = normalizePathToOs(match[1]);
        const content = match[2].replace(/\n+$/, "");
        // Don't override a patch already captured for this file
        if (!fileMap[filePath]) {
          fileMap[filePath] = { filePath, type: "full", content };
        }
      }
    }

    return Object.values(fileMap);
  }

  /**
   * Detect if the AI's response suggests more files will follow (chunked output).
   * @param {string} response
   * @returns {boolean}
   */
  hasContinuationSignal(response) {
    if (!response || typeof response !== "string") return false;
    const lower = response.toLowerCase();
    const signals = [
      "i'll continue",
      "next i'll create",
      "remaining files",
      "here are the rest",
      "continuing with",
      "more files to add",
      "let me also create",
      "additionally",
      "i'll now create",
      "in the next message",
      "following files",
    ];
    return signals.some((s) => lower.includes(s));
  }

  preview(changes) {
    if (changes.length === 0) {
      console.log("⚠️  No file changes detected in response.");
      return;
    }

    console.log(`\n📋 CHANGES PREVIEW (${changes.length} files):`);
    console.log("─".repeat(50));

    for (const change of changes) {
      const fullPath = path.join(this.projectPath, change.filePath);
      const exists = fs.existsSync(fullPath);
      if (change.type === "patch") {
        console.log(`  🔧 PATCH  ${change.filePath} (${change.hunks.length} hunk(s))`);
        change.hunks.forEach((h, i) => {
          const removeLines = h.search.split("\n").length;
          const addLines = h.replace.split("\n").length;
          console.log(`       hunk ${i + 1}: -${removeLines} lines  +${addLines} lines`);
        });
      } else {
        const lines = change.content.split("\n").length;
        console.log(`  ${exists ? "✏️  REPLACE (full file)" : "🆕 CREATE"} ${change.filePath} (${lines} lines)`);
      }
    }

    console.log("─".repeat(50));
  }

  async apply(changes, { dryRun = false } = {}) {
    if (changes.length === 0) {
      console.log("⚠️  Nothing to apply.");
      return { success: 0, failed: 0, appliedChanges: [] };
    }

    this._lastBackupPaths = {};
    let success = 0;
    let failed = 0;
    const appliedChanges = [];

    for (const change of changes) {
      const fullPath = path.join(this.projectPath, change.filePath);

      try {
        if (dryRun) {
          if (change.type === "patch") {
            console.log(`🔍 [DRY RUN] Would patch: ${change.filePath} (${change.hunks.length} hunk(s))`);
          } else {
            console.log(`🔍 [DRY RUN] Would write: ${change.filePath}`);
          }
          success++;
          continue;
        }

        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });

        if (change.type === "patch") {
          if (!fs.existsSync(fullPath)) {
            console.error(`❌ Cannot patch ${change.filePath}: file does not exist.`);
            failed++;
            continue;
          }

          const backupPath = `${fullPath}.bak.${Date.now()}`;
          fs.copyFileSync(fullPath, backupPath);
          this._lastBackupPaths[change.filePath] = backupPath;

          let content = fs.readFileSync(fullPath, "utf-8");
          let allFound = true;

          for (let i = 0; i < change.hunks.length; i++) {
            const { search, replace } = change.hunks[i];
            if (!content.includes(search)) {
              console.error(`❌ Hunk ${i + 1} not found in ${change.filePath}`);
              console.error(`   Looking for:\n${search.substring(0, 120)}`);
              allFound = false;
              break;
            }
            // Replace only first occurrence — most targeted
            content = content.replace(search, replace);
          }

          if (!allFound) {
            // Roll back — don't leave a partially patched file
            fs.copyFileSync(backupPath, fullPath);
            fs.unlinkSync(backupPath);
            failed++;
            continue;
          }

          fs.writeFileSync(fullPath, content, "utf-8");
          appliedChanges.push({ ...change, backupPath });
          console.log(`✅ Patched: ${change.filePath} (${change.hunks.length} hunk(s))`);
          success++;
        } else {
          // Full file write — for new files or when AI returns complete content
          if (fs.existsSync(fullPath)) {
            const backupPath = `${fullPath}.bak.${Date.now()}`;
            fs.copyFileSync(fullPath, backupPath);
            this._lastBackupPaths[change.filePath] = backupPath;
            appliedChanges.push({ ...change, backupPath });
          } else {
            appliedChanges.push({ ...change });
          }
          fs.writeFileSync(fullPath, change.content, "utf-8");
          console.log(`✅ Written: ${change.filePath}`);
          success++;
        }
      } catch (err) {
        console.error(`❌ Failed ${change.filePath}:`, err.message);
        failed++;
      }
    }

    console.log(`\n📊 Result: ${success} success, ${failed} failed`);
    return { success, failed, appliedChanges };
  }

  // Detects context requests in DeepSeek's response.
  // Handles both the structured NEED_CONTEXT: block AND raw FILE:/QUESTION: lines
  // that DeepSeek writes when it ignores the format instruction.
  // Returns { files: [...], questions: [...] } or null if nothing found.
  parseContextRequests(response) {
    const files = [];
    const questions = [];

    // Strategy 1: structured NEED_CONTEXT block (ideal case)
    const blockMatch = response.match(/NEED_CONTEXT:\s*\n([\s\S]*?)(?:\n\n|$)/);
    const linesToScan = blockMatch
      ? blockMatch[1].split("\n")   // only scan inside the block
      : response.split("\n");       // fallback: scan entire response

    const KNOWN_EXT = /\.(tsx?|jsx?|css|scss|json|html|md|py|env|yaml|yml|sh)$/i;

    for (const line of linesToScan) {
      const trimmed = line.trim();

      if (trimmed.startsWith("FILE:")) {
        // Strip trailing prose like "(or any theme provider)" — take only path token
        const rawPath = trimmed.slice(5).trim().split(/\s+/)[0];
        if (rawPath && rawPath.includes(".")) files.push(rawPath);

      } else if (trimmed.startsWith("QUESTION:")) {
        const q = trimmed.slice(9).trim();
        if (q) questions.push(q);

      } else if (
        // Detect bare file paths DeepSeek writes WITHOUT FILE: prefix
        // e.g. "src/screens/EditProductPage.tsx" on its own line
        KNOWN_EXT.test(trimmed) &&
        (trimmed.includes("/") || trimmed.includes("\\")) &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("`") &&
        !trimmed.startsWith("-") &&
        !trimmed.includes(" ")   // real bare paths have no spaces
      ) {
        const cleanPath = trimmed.replace(/\\/g, "/");
        if (!files.includes(cleanPath)) files.push(cleanPath);
      }
    }

    if (files.length === 0 && questions.length === 0) return null;
    return { files, questions };
  }

  restoreBackups(changes) {
    for (const change of changes) {
      const fullPath = path.join(this.projectPath, change.filePath);
      const backupPath =
        change.backupPath || this._lastBackupPaths[change.filePath] || `${fullPath}.bak`;
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, fullPath);
        fs.unlinkSync(backupPath);
        console.log(`🔄 Restored: ${change.filePath}`);
      }
    }
  }

  cleanOrphanBackups() {
    let removed = 0;
    const scan = (dirPath) => {
      let entries;
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (!EXCLUDE_DIRS.includes(entry.name)) scan(fullPath);
          continue;
        }
        if (entry.name.includes(".bak.")) {
          try {
            fs.unlinkSync(fullPath);
            removed++;
          } catch {
            // ignore
          }
        }
      }
    };
    scan(this.projectPath);
    return removed;
  }
}

module.exports = ResponseParser;
