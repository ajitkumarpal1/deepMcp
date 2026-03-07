const { chromium } = require("playwright");
const path = require("path");
const selectorsConfig = require("./selectors.config");

const SESSION_PATH = path.join(__dirname, "../.session");

class DeepSeekBrowser {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
  }

  async launch(options = {}) {
    this._onLoginWait = options.onLoginWait || null;
    console.log("🚀 Launching browser...");

    try {
      this.browser = await chromium.launchPersistentContext(SESSION_PATH, {
        headless: false,
        viewport: { width: 1280, height: 800 },
        args: ["--no-sandbox"],
      });
    } catch (err) {
      if (err.message && err.message.includes("Executable doesn't exist")) {
        console.error("\n❌ Playwright Chromium is not installed.");
        console.error("   Run this once, then try again:\n");
        console.error("   npx playwright install chromium\n");
      }
      throw err;
    }

    this.page = this.browser.pages()[0] || (await this.browser.newPage());

    await this.page.goto("https://chat.deepseek.com", {
      waitUntil: "networkidle",
    });

    const isLoggedIn = await this._checkLogin();

    if (!isLoggedIn) {
      console.log("⚠️  Not logged in. Please login manually in the browser...");
      await this._waitForLogin();
    } else {
      console.log("✅ Already logged in!");
    }

    this.isReady = true;
    return this;
  }

  async _checkLogin() {
    try {
      await this.page.waitForSelector("textarea", { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async _waitForLogin() {
    if (this._onLoginWait) {
      await this._onLoginWait();
    } else {
      console.log("👉 Browser mein login karo, phir Enter dabao terminal mein...");
      await new Promise((resolve) => {
        process.stdin.once("data", resolve);
      });
    }
    console.log("✅ Login confirmed!");
  }

  async sendMessage(message, options = {}) {
    if (!this.isReady) throw new Error("Browser not ready. Call launch() first.");

    const newChat = options.newChat !== false;
    console.log("📤 Sending message to DeepSeek...");
    if (newChat) await this._startNewChat();

    const textarea = await this.page.waitForSelector("textarea");
    await textarea.click();
    await textarea.fill(message);
    await this.page.keyboard.press("Enter");

    const response = await this._waitForResponse();
    console.log(`\n✅ Response received! (${response.length} chars)`);

    return response;
  }

  async _startNewChat() {
    try {
      await this.page.goto("https://chat.deepseek.com", {
        waitUntil: "networkidle",
      });
      await this.page.waitForTimeout(1000);
    } catch (e) {
      console.warn("⚠️  Could not start new chat:", e.message);
    }
  }

  async _waitForResponse() {
    // Step 1: Find whichever stop button selector is active
    const stopSel = await this._findActiveStopSelector();

    if (stopSel) {
      // Step 2: Wait for it to disappear (generation complete)
      try {
        await this.page.waitForSelector(stopSel, {
          state: "detached",
          timeout: 300000,
        });
      } catch {
        // Timeout — extract whatever is there
      }
    } else {
      // Fallback: try aria-busy spinner
      const spinnerSel = selectorsConfig.sendingSpinner;
      if (spinnerSel && spinnerSel.trim()) {
        try {
          await this.page.waitForSelector(spinnerSel, { timeout: 10000 });
          await this.page.waitForSelector(spinnerSel, {
            state: "detached",
            timeout: 300000,
          });
        } catch {
          // Last resort: wait for textarea to become interactive again
          return await this._waitForTextareaReady();
        }
      } else {
        return await this._waitForTextareaReady();
      }
    }

    // Step 3: Check for Continue button (truncated response)
    const continueBtn = await this._findContinueButton();
    if (continueBtn) {
      console.log("\n🔄 Continue button found, clicking...");
      await continueBtn.click();
      await this.page.waitForTimeout(1500);
      return await this._waitForResponse();
    }

    // Step 4: Extract final response
    return await this._extractLastResponse();
  }

  // Polls all stopButtonSelectors quickly; returns the first one visible, or null.
  async _findActiveStopSelector() {
    const selectors = selectorsConfig.stopButtonSelectors;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        try {
          const el = await this.page.$(sel);
          if (el) return sel;
        } catch {}
      }
      await this.page.waitForTimeout(200);
    }
    return null;
  }

  // Last-resort fallback: wait until textarea is interactive (generation done).
  async _waitForTextareaReady() {
    try {
      await this.page.waitForFunction(
        () => {
          const ta = document.querySelector("textarea");
          return ta && !ta.disabled && ta.getAttribute("aria-disabled") !== "true";
        },
        { timeout: 300000 }
      );
    } catch {}
    return await this._extractLastResponse();
  }

  async _findContinueButton() {
    const selectors = selectorsConfig.continueSelectors;
    for (const sel of selectors) {
      try {
        const btn = await this.page.waitForSelector(sel, { timeout: 200 });
        if (btn) return btn;
      } catch {
        continue;
      }
    }
    return null;
  }

  async _extractLastResponse() {
    const candidates = selectorsConfig.responseContentSelectors;
    return await this.page.evaluate((candidates) => {
      for (const sel of candidates) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          return els[els.length - 1].innerText || "";
        }
      }
      return "";
    }, candidates);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.isReady = false;
    }
  }
}

module.exports = DeepSeekBrowser;
