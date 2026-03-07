const fs = require("fs");
const path = require("path");

const FRAMEWORK_COMMANDS = {
  next: { install: "npm install", dev: "npm run dev", build: "npm run build" },
  vite: { install: "npm install", dev: "npm run dev", build: "npm run build" },
  "react-scripts": { install: "npm install", dev: "npm start", build: "npm run build" },
  nuxt: { install: "npm install", dev: "npm run dev" },
  express: { install: "npm install", dev: "node index.js" },
};

/**
 * Detect framework from package.json dependencies.
 * @param {string} projectPath
 * @returns {{ name: string, commands: object } | null}
 */
function detectFramework(projectPath) {
  const pkgPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...(pkg.devDependencies || {}) };
    if (deps.next) return { name: "Next.js", commands: FRAMEWORK_COMMANDS.next };
    if (deps.vite) return { name: "Vite", commands: FRAMEWORK_COMMANDS.vite };
    if (deps["react-scripts"]) return { name: "Create React App", commands: FRAMEWORK_COMMANDS["react-scripts"] };
    if (deps.nuxt) return { name: "Nuxt", commands: FRAMEWORK_COMMANDS.nuxt };
    if (deps.express) return { name: "Express", commands: FRAMEWORK_COMMANDS.express };
    if (deps.react || deps.vue) return { name: "JS", commands: { install: "npm install", dev: "npm run dev", build: "npm run build" } };
  } catch {
    // ignore
  }
  return null;
}

/**
 * Suggest commands to run after applying changes.
 * @param {Array<{ filePath: string }>} appliedChanges - applied file changes (relative paths)
 * @param {string} projectPath
 * @returns {{ suggested: Array<{ label: string, command: string }>, framework: string | null }}
 */
function suggestCommands(appliedChanges, projectPath) {
  const appliedPaths = (appliedChanges || []).map((c) => c.filePath.replace(/\\/g, "/"));
  const framework = detectFramework(projectPath);
  const suggested = [];

  const hasPackageJson = appliedPaths.some((p) => p === "package.json" || p.endsWith("/package.json"));
  if (hasPackageJson) {
    suggested.push({ label: "npm install", command: "npm install" });
  }

  if (framework && framework.commands) {
    if (framework.commands.dev && !suggested.some((s) => s.command === framework.commands.dev)) {
      suggested.push({ label: `dev (${framework.name})`, command: framework.commands.dev });
    }
    if (framework.commands.build && !suggested.some((s) => s.command === framework.commands.build)) {
      suggested.push({ label: "build", command: framework.commands.build });
    }
  }

  // If no framework but package.json was touched, still suggest install + generic dev
  if (hasPackageJson && suggested.length === 1) {
    suggested.push({ label: "npm run dev", command: "npm run dev" });
  }

  return {
    suggested,
    framework: framework ? framework.name : null,
  };
}

module.exports = {
  detectFramework,
  suggestCommands,
  FRAMEWORK_COMMANDS,
};
