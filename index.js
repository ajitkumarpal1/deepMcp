#!/usr/bin/env node

const path = require("path");
const fs = require("fs");
const MCPOrchestrator = require("./src/orchestrator");

const projectPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

if (!fs.existsSync(projectPath)) {
  console.error(`❌ Path not found: ${projectPath}`);
  process.exit(1);
}

// If no argument was given, remind user they can point to another project
if (!process.argv[2]) {
  console.error("💡 Tip: Using current directory as project. To use another project, run:\n");
  console.error("   node index.js <path-to-your-project>\n");
  console.error("   Example: node index.js C:\\Users\\Ajit\\Desktop\\my-react-app\n");
}

const mcp = new MCPOrchestrator(projectPath);
mcp.run().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
