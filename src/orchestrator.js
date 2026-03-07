const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const DeepSeekBrowser = require("./deepseek-browser");
const ContextBuilder = require("./context-builder");
const ResponseParser = require("./response-parser");
const { suggestCommands } = require("./post-apply-runner");

class MCPOrchestrator {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.browser = new DeepSeekBrowser();
    this.contextBuilder = new ContextBuilder(projectPath);
    this.parser = new ResponseParser(projectPath);
    this._lastChanges = [];
    this._useMultiTurn = true; // Same chat until user stops — use "multi" to toggle new-chat-per-query
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async init() {
    console.log("\n" + "═".repeat(60));
    console.log("   🤖 DeepSeek MCP Layer — Study Project");
    console.log("═".repeat(60));
    console.log(`📂 Project: ${this.projectPath}\n`);

    this.contextBuilder.scan();
    const files = this.contextBuilder.getFiles();
    console.log(`\n📄 Files found:\n  ${files.join("\n  ")}\n`);

    await this.browser.launch({
      onLoginWait: () => this._prompt("Press Enter after logging in... "),
    });
    console.log("\n✅ MCP Layer ready! Same chat is ON (one conversation until you stop). Type 'multi' to toggle.\n");
  }

  async run() {
    await this.init();
    await this._loop();
  }

  async _loop() {
    while (true) {
      const query = await this._prompt("\n💬 Your query (or 'exit' / 'undo' / 'run <cmd>' / 'clean' / 'multi'):\n> ");

      const q = query.toLowerCase().trim();
      if (q === "exit") {
        console.log("\n👋 Bye!");
        await this.browser.close();
        this.rl.close();
        break;
      }

      if (q === "undo") {
        if (this._lastChanges.length === 0) {
          console.log("⚠️  No previous apply to undo.");
        } else {
          this.parser.restoreBackups(this._lastChanges);
          this._lastChanges = [];
          console.log("✅ Undo complete.");
        }
        continue;
      }

      if (q === "clean") {
        const removed = this.parser.cleanOrphanBackups();
        console.log(`✅ Cleaned ${removed} orphan backup file(s).`);
        continue;
      }

      if (q.startsWith("run ")) {
        const cmd = query.slice(4).trim();
        if (!cmd) {
          console.log("⚠️  Usage: run <command> (e.g. run npm install)");
        } else {
          await this._runCommand(cmd);
        }
        continue;
      }

      if (q === "multi" || q === "multiturn") {
        this._useMultiTurn = !this._useMultiTurn;
        console.log(`Same chat: ${this._useMultiTurn ? "ON (one conversation until you stop)" : "OFF (new chat per query)"}`);
        continue;
      }

      if (!query.trim()) continue;

      try {
        await this._processQuery(query);
      } catch (err) {
        console.error("\n❌ Error:", err.message);
      }
    }
  }

  async _processQuery(userQuery) {
    console.log("\n📦 Building context...");
    const prompt = this.contextBuilder.buildPrompt(userQuery);
    console.log(`📏 Prompt size: ${prompt.length} chars`);

    // Initial send to DeepSeek
    let response = await this.browser.sendMessage(prompt, {
      newChat: !this._useMultiTurn,
    });
    if ((!response || !response.trim()) && this.browser.isReady) {
      console.log("⚠️  Empty response, retrying once...");
      response = await this.browser.sendMessage(prompt, {
        newChat: !this._useMultiTurn,
      });
    }
    if (!response || !response.trim()) {
      console.log("⚠️  Empty response received.");
      return;
    }

    // Context-gathering loop — runs until DeepSeek gives code or stops asking
    const MAX_ROUNDS = 5;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      this._saveLog(response);

      const contextRequests = this.parser.parseContextRequests(response);
      const changes = this.parser.parse(response);

      // DeepSeek gave code changes — done
      if (changes.length > 0) break;

      // DeepSeek is not asking for context either — show raw and stop
      if (!contextRequests) break;

      // DeepSeek needs more info — gather it and send follow-up in same chat
      console.log(`\n🔄 DeepSeek needs more context (round ${round + 1}/${MAX_ROUNDS}):`);

      let followUp = "Here is the additional context you requested:\n\n";

      for (const filePath of contextRequests.files) {
        const fullPath = path.join(this.projectPath, filePath.replace(/\//g, path.sep));
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          followUp += `### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n\n`;
          console.log(`  📄 Sending file: ${filePath}`);
        } else {
          followUp += `Note: File "${filePath}" does not exist in this project.\n\n`;
          console.log(`  ❌ File not found: ${filePath}`);
        }
      }

      for (const question of contextRequests.questions) {
        const autoAnswer = this._tryAutoAnswer(question);
        if (autoAnswer) {
          console.log(`  🔍 Auto-answered: ${question}`);
          followUp += `Q: ${question}\nA: (Found in project) ${autoAnswer}\n\n`;
        } else {
          console.log(`\n  ❓ DeepSeek asks (not found in project): ${question}`);
          const answer = await this._prompt(`  Your answer: `);
          followUp += `Q: ${question}\nA: ${answer}\n\n`;
        }
      }

      followUp += "Now please provide the code changes using the SEARCH/REPLACE format.";

      response = await this.browser.sendMessage(followUp, { newChat: false });
      if (!response || !response.trim()) {
        console.log("⚠️  Empty follow-up response.");
        break;
      }
    }

    // Final response — save and apply
    this._saveLog(response);
    let changes = this.parser.parse(response);
    this.parser.preview(changes);

    // If no code changes yet, keep the conversation going in the SAME chat
    // instead of dropping back to the main prompt (which would start a new chat)
    while (changes.length === 0) {
      console.log("\n📖 DeepSeek says:");
      console.log("─".repeat(50));
      console.log(response.substring(0, 1500) + (response.length > 1500 ? "\n...[truncated]" : ""));
      console.log("─".repeat(50));

      const reply = await this._prompt("\n  💬 Reply in same chat (or Enter to return to main prompt): ");
      if (!reply.trim()) return;

      response = await this.browser.sendMessage(reply, { newChat: false });
      this._saveLog(response);
      changes = this.parser.parse(response);
      this.parser.preview(changes);
    }

    const confirm = await this._prompt(
      `\n⚡ Apply ${changes.length} file change(s)? (y/n/dry): `
    );

    if (confirm.toLowerCase() === "dry") {
      await this.parser.apply(changes, { dryRun: true });
    } else if (confirm.toLowerCase() === "y") {
      const result = await this.parser.apply(changes);
      this._lastChanges = result.appliedChanges || [];
      console.log("\n✅ Changes applied!");

      // Phase 1: suggest and optionally run commands after apply
      const { suggested, framework } = suggestCommands(this._lastChanges, this.projectPath);
      if (suggested.length > 0) {
        console.log(framework ? `\nDetected: ${framework} project` : "");
        console.log("Suggested commands:");
        suggested.forEach((s, i) => console.log(`  ${i + 1}) ${s.label}`));
        console.log(`  ${suggested.length + 1}) skip`);
        const choice = await this._prompt(`\nRun which? (1-${suggested.length + 1}/Enter to skip): `);
        const num = parseInt(choice.trim(), 10);
        if (num >= 1 && num <= suggested.length) {
          const cmd = suggested[num - 1].command;
          console.log(`\n▶ Running: ${cmd}\n`);
          await this._runCommand(cmd);
        }
      }

      // Phase 2: chunked output — if AI signaled more files, ask to continue in same chat
      let currentResponse = response;
      while (this.parser.hasContinuationSignal(currentResponse)) {
        const cont = await this._prompt("\nAI may have more files to create. Continue in same chat? (y/Enter to skip): ");
        if (cont.toLowerCase().trim() !== "y") break;
        const followUp =
          "Those files were applied successfully.\nPlease continue and provide the remaining files in the same SEARCH/REPLACE or full-file format.";
        currentResponse = await this.browser.sendMessage(followUp, { newChat: false });
        this._saveLog(currentResponse);
        const moreChanges = this.parser.parse(currentResponse);
        if (moreChanges.length === 0) {
          console.log("⚠️  No file changes in follow-up response.");
          break;
        }
        this.parser.preview(moreChanges);
        const confirmMore = await this._prompt(`\n⚡ Apply ${moreChanges.length} file change(s)? (y/n/dry): `);
        if (confirmMore.toLowerCase() === "dry") {
          await this.parser.apply(moreChanges, { dryRun: true });
          break;
        }
        if (confirmMore.toLowerCase() !== "y") break;
        const resultMore = await this.parser.apply(moreChanges);
        this._lastChanges = resultMore.appliedChanges || [];
        console.log("\n✅ Changes applied!");
        // suggest commands for this batch too
        const { suggested: suggestedMore, framework: frameworkMore } = suggestCommands(this._lastChanges, this.projectPath);
        if (suggestedMore.length > 0) {
          console.log(frameworkMore ? `\nDetected: ${frameworkMore} project` : "");
          console.log("Suggested commands:");
          suggestedMore.forEach((s, i) => console.log(`  ${i + 1}) ${s.label}`));
          console.log(`  ${suggestedMore.length + 1}) skip`);
          const choiceMore = await this._prompt(`\nRun which? (1-${suggestedMore.length + 1}/Enter to skip): `);
          const numMore = parseInt(choiceMore.trim(), 10);
          if (numMore >= 1 && numMore <= suggestedMore.length) {
            console.log(`\n▶ Running: ${suggestedMore[numMore - 1].command}\n`);
            await this._runCommand(suggestedMore[numMore - 1].command);
          }
        }
      }
    } else {
      console.log("⏭️  Skipped. Response saved in logs/");
    }
  }

  // Returns true if question is asking for user preference/input, not project info.
  // These cannot be auto-answered from project files.
  _isUserPreferenceQuestion(question) {
    const q = question.toLowerCase();
    const indicators = [
      "want", "like", "prefer", "would you", "do you", "please tell",
      "please provide", "please specify", "what color", "which color",
      "what style", "what value", "what should", "what do you",
      "tell me", "provide the color", "specify", "choose",
    ];
    return indicators.some((w) => q.includes(w));
  }

  // Searches the project to auto-answer DeepSeek's questions.
  // Returns a string with relevant findings, or null if nothing useful found.
  _tryAutoAnswer(question) {
    // Never auto-answer user-preference questions — they need real user input
    if (this._isUserPreferenceQuestion(question)) return null;
    const stopWords = new Set([
      "what", "which", "is", "are", "the", "a", "an", "how", "do", "does",
      "you", "using", "use", "being", "project", "this", "that", "with",
      "for", "in", "of", "to", "and", "or", "your", "any", "have",
    ]);

    // Extract meaningful keywords from the question
    const keywords = question
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    if (keywords.length === 0) return null;

    const results = [];

    // Always check package.json first — covers most tech stack questions
    const pkgPath = path.join(this.projectPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkgContent = fs.readFileSync(pkgPath, "utf-8");
        const relevantLines = pkgContent
          .split("\n")
          .filter((line) => keywords.some((kw) => line.toLowerCase().includes(kw)));
        if (relevantLines.length > 0) {
          results.push(`package.json:\n${relevantLines.join("\n")}`);
        }
      } catch {}
    }

    // Check config files in project
    const configFiles = this.contextBuilder
      .getFiles()
      .filter(
        (f) =>
          f.includes("config") ||
          f.includes(".env") ||
          f.endsWith("tsconfig.json") ||
          f.endsWith(".babelrc")
      );

    for (const relPath of configFiles.slice(0, 6)) {
      const fullPath = path.join(this.projectPath, relPath.replace(/\//g, path.sep));
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const relevantLines = content
          .split("\n")
          .filter((line) => keywords.some((kw) => line.toLowerCase().includes(kw)));
        if (relevantLines.length > 0) {
          results.push(`${relPath}:\n${relevantLines.slice(0, 8).join("\n")}`);
        }
      } catch {}
    }

    // If still nothing, do a broad keyword search across all project files
    if (results.length === 0) {
      for (const relPath of this.contextBuilder.getFiles().slice(0, 20)) {
        const fullPath = path.join(this.projectPath, relPath.replace(/\//g, path.sep));
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const relevantLines = content
            .split("\n")
            .filter((line) => keywords.some((kw) => line.toLowerCase().includes(kw)));
          if (relevantLines.length > 0) {
            results.push(`${relPath}:\n${relevantLines.slice(0, 5).join("\n")}`);
            break; // One match is enough for the broad fallback
          }
        } catch {}
      }
    }

    return results.length > 0 ? results.join("\n\n") : null;
  }

  _saveLog(response) {
    const logsDir = path.join(__dirname, "../logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, `response-${Date.now()}.txt`),
      response,
      "utf-8"
    );
  }

  _prompt(question) {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  _runCommand(cmd) {
    return new Promise((resolve) => {
      const child = spawn(cmd, [], {
        cwd: this.projectPath,
        shell: true,
        stdio: "inherit",
      });
      child.on("close", (code) => {
        console.log(`\n[Command exited with code ${code}]`);
        resolve();
      });
      child.on("error", (err) => {
        console.error("Command failed:", err.message);
        resolve();
      });
    });
  }
}

module.exports = MCPOrchestrator;
