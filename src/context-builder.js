const fs = require("fs");
const path = require("path");

const INCLUDE_EXTENSIONS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".json",
  ".html",
  ".md",
  ".py",
];

const INCLUDE_FILENAMES = [".env.example"];

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

const MAX_FILE_SIZE_KB = 100;
const MAX_TOTAL_CHARS = 80000;

const ENTRY_POINT_NAMES = ["index", "app", "main"];
const PRIORITY_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx"];

function parseGitignore(projectPath) {
  const gitignorePath = path.join(projectPath, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return [];
  try {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim().replace(/^\/+/, ""))
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function isExcludedByGitignore(relativePath, gitignorePatterns) {
  const normalized = relativePath.replace(/\\/g, "/");
  for (const pattern of gitignorePatterns) {
    if (pattern.includes("*")) {
      const re = new RegExp(
        "^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"
      );
      if (re.test(normalized)) return true;
    } else if (normalized === pattern || normalized.startsWith(pattern + "/")) {
      return true;
    }
  }
  return false;
}

function filePriority(fullPath, projectPath) {
  const relative = path.relative(projectPath, fullPath).replace(/\\/g, "/");
  const base = path.basename(fullPath, path.extname(fullPath));
  const ext = path.extname(fullPath).toLowerCase();

  if (relative === "package.json" || relative === "README.md") return 0;
  if (
    ENTRY_POINT_NAMES.includes(base) &&
    PRIORITY_EXTENSIONS.includes(ext)
  ) {
    if (relative.split("/").length <= 2) return 1;
  }
  if (relative.startsWith("src/")) return 2;
  return 3;
}

class ContextBuilder {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.files = [];
    this.gitignorePatterns = parseGitignore(this.projectPath);
    this._contextCache = null;
    this._contextCacheMtimes = null;
  }

  scan() {
    this.files = [];
    const mergedDirs = [...EXCLUDE_DIRS];
    for (const p of this.gitignorePatterns) {
      if (!p.includes("/") && !p.includes("*")) mergedDirs.push(p);
    }
    this._excludeDirs = mergedDirs;
    this._scanDir(this.projectPath);
    this.files = this.files.filter((f) => {
      const rel = path.relative(this.projectPath, f).replace(/\\/g, "/");
      return !isExcludedByGitignore(rel, this.gitignorePatterns);
    });
    console.log(`📁 Found ${this.files.length} files in: ${this.projectPath}`);
    this._contextCache = null;
    return this;
  }

  _scanDir(dirPath) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    const excludeDirs = this._excludeDirs || EXCLUDE_DIRS;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!excludeDirs.includes(entry.name)) {
          this._scanDir(path.join(dirPath, entry.name));
        }
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const includeByExt = INCLUDE_EXTENSIONS.includes(ext);
      const includeByName = INCLUDE_FILENAMES.includes(entry.name);
      if (!includeByExt && !includeByName) continue;

      const fullPath = path.join(dirPath, entry.name);
      const stats = fs.statSync(fullPath);
      if (stats.size > MAX_FILE_SIZE_KB * 1024) {
        console.log(`⏭️  Skipping large file: ${entry.name}`);
        continue;
      }

      this.files.push(fullPath);
    }
  }

  // Extract meaningful keywords from a user query.
  // Strips URLs (but pulls path segments from them), removes stop words.
  _extractQueryKeywords(query) {
    const stopWords = new Set([
      "add", "update", "change", "make", "create", "fix", "get", "set",
      "the", "a", "an", "to", "in", "on", "at", "for", "of", "with",
      "this", "that", "and", "or", "is", "it", "i", "my", "me",
      "page", "file", "please", "can", "you", "want", "need",
      "should", "would", "just", "also", "now", "then", "when",
      "http", "https", "localhost", "com", "www",
    ]);

    // Pull path segments out of URLs (e.g. localhost:3000/products → "products")
    const urlSegments = [];
    query.replace(/https?:\/\/[^\s]+/g, (url) => {
      try {
        const u = new URL(url);
        u.pathname.split("/").filter(Boolean).forEach((s) => urlSegments.push(s));
      } catch {}
    });

    const words = query
      .toLowerCase()
      .replace(/https?:\/\/[^\s]+/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    return [...new Set([...words, ...urlSegments])];
  }

  // Score a file by how relevant it is to the given keywords.
  // Path matches score highest; content matches add smaller scores.
  _scoreFile(filePath, keywords) {
    const relPath = path.relative(this.projectPath, filePath).replace(/\\/g, "/").toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      if (relPath.includes(kw)) score += 10;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8").toLowerCase();
      for (const kw of keywords) {
        const hits = (content.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
        score += Math.min(hits, 5) * 2;
      }
    } catch {}

    return score;
  }

  // Detects explicit file paths written in the user query
  // e.g. "edit src\screens\EditProductPage.tsx" → ["src/screens/EditProductPage.tsx"]
  _extractExplicitFilePaths(query) {
    const results = [];
    const pattern = /([a-zA-Z0-9_][\w\-/\\]*\.[a-zA-Z]{2,5})/g;
    let match;
    while ((match = pattern.exec(query)) !== null) {
      const p = match[1].replace(/\\/g, "/");
      if (p.includes("/")) results.push(p);
    }
    return [...new Set(results)];
  }

  // Returns only the most relevant files for the query.
  // Always-include files (layout, globals, package.json) are forced in.
  // Explicitly mentioned file paths are force-pinned regardless of limit.
  // Remaining slots filled by highest-scoring files.
  _selectRelevantFiles(keywords, maxFiles = 12, forcePaths = []) {
    const ALWAYS_INCLUDE_PATTERNS = [
      "package.json",
      "globals.css",
      "global.css",
      "layout.tsx",
      "layout.jsx",
      "layout.js",
      "layout.ts",
    ];

    const pinned = [];
    const candidates = [];

    for (const filePath of this.files) {
      const relPath = path.relative(this.projectPath, filePath).replace(/\\/g, "/");
      const base = path.basename(filePath);
      if (ALWAYS_INCLUDE_PATTERNS.some((p) => base === p || relPath.endsWith("/" + p))) {
        pinned.push(filePath);
      } else {
        candidates.push(filePath);
      }
    }

    // Force-pin files explicitly mentioned in the user's query
    for (const fp of forcePaths) {
      const needle = fp.toLowerCase();
      const found = this.files.find((f) => {
        const rel = path.relative(this.projectPath, f).replace(/\\/g, "/").toLowerCase();
        return rel === needle || rel.endsWith("/" + needle) || rel.endsWith(needle);
      });
      if (found && !pinned.includes(found)) {
        pinned.push(found);
        console.log(`📌 Force-pinned from query: ${fp}`);
      }
    }

    // Slots are relative to maxFiles but explicit pins always fit regardless
    const slots = Math.max(0, maxFiles - pinned.length);
    const scored = candidates
      .map((f) => ({ f, score: this._scoreFile(f, keywords) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, slots)
      .map((x) => x.f);

    const selected = [...pinned, ...scored];
    console.log(`🎯 Smart select: ${selected.length} files (from ${this.files.length} total) for this query`);
    return selected;
  }

  buildContext(userQuery = null) {
    const keywords = userQuery ? this._extractQueryKeywords(userQuery) : [];
    const forcePaths = userQuery ? this._extractExplicitFilePaths(userQuery) : [];
    const filesToInclude = keywords.length > 0
      ? this._selectRelevantFiles(keywords, 12, forcePaths)
      : [...this.files].sort((a, b) => filePriority(a, this.projectPath) - filePriority(b, this.projectPath));

    // Cache: only reuse if same query and files unchanged
    const cacheKey = userQuery || "__all__";
    const mtimes = filesToInclude.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } });
    if (
      this._contextCache &&
      this._contextCacheKey === cacheKey &&
      this._contextCacheMtimes &&
      this._contextCacheMtimes.length === mtimes.length &&
      this._contextCacheMtimes.every((m, i) => m === mtimes[i])
    ) {
      return this._contextCache;
    }

    let context = `# PROJECT CONTEXT\n`;
    context += `Project Path: ${this.projectPath}\n`;
    context += `Total Files: ${this.files.length} (showing ${filesToInclude.length} most relevant)\n\n`;
    context += `## FILE TREE (all files)\n`;
    context += this._buildFileTree() + "\n\n";
    context += `## FILE CONTENTS (relevant files only)\n`;

    let totalChars = context.length;
    let includedFiles = 0;

    for (const filePath of filesToInclude) {
      const relativePath = path.relative(this.projectPath, filePath).replace(/\\/g, "/");
      let content;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      const fileBlock = `\n### ${relativePath}\n\`\`\`\n${content}\n\`\`\`\n`;

      if (totalChars + fileBlock.length > MAX_TOTAL_CHARS) {
        context += `\n⚠️  Context limit reached. Some files omitted.\n`;
        break;
      }

      context += fileBlock;
      totalChars += fileBlock.length;
      includedFiles++;
    }

    this._contextCache = context;
    this._contextCacheKey = cacheKey;
    this._contextCacheMtimes = mtimes;
    return context;
  }

  _buildFileTree() {
    const tree = {};
    for (const filePath of this.files) {
      const relative = path.relative(this.projectPath, filePath);
      const parts = relative.split(path.sep);
      let node = tree;
      for (const part of parts) {
        if (!node[part]) node[part] = {};
        node = node[part];
      }
    }
    return this._renderTree(tree, "");
  }

  _renderTree(node, indent) {
    let result = "";
    for (const key of Object.keys(node)) {
      const isFile = Object.keys(node[key]).length === 0;
      result += `${indent}${isFile ? "📄" : "📁"} ${key}\n`;
      if (!isFile) result += this._renderTree(node[key], indent + "  ");
    }
    return result;
  }

  buildPrompt(userQuery) {
    const context = this.buildContext(userQuery);
    return `CRITICAL — MANDATORY RESPONSE FORMAT RULES (read before anything else):
1. For EXISTING files you must use SEARCH/REPLACE blocks ONLY. Never rewrite the whole file.
2. For NEW files use a full code block.
3. If you need more context before coding, use NEED_CONTEXT block ONLY — no code at all.
4. Do NOT mix formats. Do NOT add prose before or after code blocks.

---

${context}

---

# YOUR TASK
${userQuery}

## INSTRUCTIONS
- Modify only the relevant files.
- For EXISTING files, use SEARCH/REPLACE blocks — do NOT rewrite the whole file.
- For NEW files that don't exist yet, use a full code block.
- If you need to create many files, split across messages. After each batch say "I'll continue with more files..." and the user will ask you to continue.
- If you need more information, use NEED_CONTEXT format — do NOT guess.

## RESPONSE FORMAT (MANDATORY — deviating will break the automated apply tool)

### Option A — Need more information first (NO code, ONLY this block):

NEED_CONTEXT:
FILE: path/to/file.js
FILE: path/to/another.ts
QUESTION: What is the expected behavior when X happens?
QUESTION: Which CSS framework is being used?

### Option B — Ready to make changes:

For EXISTING files — SEARCH/REPLACE (EXACT match required):

### path/to/file.js
<<<<<<< SEARCH
[exact lines from the current file — same indentation and whitespace]
=======
[replacement lines]
>>>>>>> REPLACE

Rules:
- SEARCH must match the file EXACTLY — character for character.
- One block per logical change. Multiple blocks allowed per file.
- Only include the lines that change, not the whole file.
- Paths must use forward slashes (e.g. src/components/App.tsx).

For NEW files:

### path/to/newfile.js
\`\`\`js
[complete file content]
\`\`\`
`;
  }

  getFiles() {
    return this.files.map((f) =>
      path.relative(this.projectPath, f).replace(/\\/g, "/")
    );
  }
}

module.exports = ContextBuilder;
