/**
 * Path traversal protection utility.
 *
 * Ensures that any file path given by an MCP client resolves to a location
 * inside the project root. Blocks attacks like:
 *   "path": "../../.ssh/id_rsa"
 *   "path": "/etc/passwd"
 */
const path = require('path');

/**
 * Resolves `filePath` relative to `projectPath` and throws if the result
 * escapes the project root.
 *
 * @param {string} filePath   - Relative (or absolute) path from MCP args
 * @param {string} projectPath - Absolute project root
 * @returns {string} Resolved absolute path (safe to use)
 * @throws {Error} If the path is outside the project root
 */
function guardPath(filePath, projectPath) {
  const root     = path.resolve(projectPath);
  const resolved = path.resolve(root, filePath);

  // Must start with root + separator (or equal root itself)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(
      `Path traversal blocked: "${filePath}" resolves outside project root.`
    );
  }

  return resolved;
}

module.exports = { guardPath };
