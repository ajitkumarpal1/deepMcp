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
    // Step 1: Wait for generation to START — send button becomes disabled.
    // DeepSeek adds ds-icon-button--disabled + aria-disabled="true" while generating.
    try {
      await this.page.waitForFunction(
        () => !!document.querySelector('.ds-icon-button--disabled[aria-disabled="true"]'),
        { timeout: 15000, polling: 200 }
      );
    } catch {
      // May have started and finished very quickly — continue
    }

    // Step 2: Wait for generation to END — ds-icon-button--disabled class removed from send button.
    // NOTE: Do NOT add a second selector here — other page elements may always have
    // aria-disabled="true" (emoji pickers, attachment buttons, etc.) and will cause this to hang.
    try {
      await this.page.waitForFunction(
        () => !document.querySelector('.ds-icon-button--disabled[aria-disabled="true"]'),
        { timeout: 300000, polling: 300 }
      );
    } catch {
      // Timeout — extract whatever is there
    }

    // Step 3: Stabilization pause — let the last streaming tokens land.
    await this.page.waitForTimeout(1000);

    // Step 4: Double-check — if button is disabled again, we caught a mid-transition
    // gap (DeepSeek's thinking→generation handoff). Re-wait in that case.
    const stillGenerating = await this.page.evaluate(
      () => !!document.querySelector('.ds-icon-button--disabled[aria-disabled="true"]')
    );
    if (stillGenerating) {
      return await this._waitForResponse();
    }

    // Step 5: Check for Continue button (truncated response)
    const continueBtn = await this._findContinueButton();
    if (continueBtn) {
      console.log("\n🔄 Continue button found, clicking...");
      await continueBtn.click();
      await this.page.waitForTimeout(1500);
      return await this._waitForResponse();
    }

    // Step 6: Extract final response
    return await this._extractLastResponse();
  }

  async _findContinueButton() {
    const selectors = selectorsConfig.continueSelectors;
    // Poll every 200ms for up to 3 seconds.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      // Try Playwright CSS/text selectors first
      for (const sel of selectors) {
        try {
          const btn = await this.page.$(sel);
          if (btn) return btn;
        } catch {}
      }

      // DOM fallback using page.$$() — proper ElementHandles, no serialization issues.
      // Checks visible innerText only (not textContent) to avoid matching hidden aria text.
      // Length cap of 30 chars avoids matching prose that happens to contain "continue".
      const allBtns = await this.page.$$('button, [role="button"]');
      for (const btn of allBtns) {
        try {
          const text = (await btn.innerText()).trim().toLowerCase();
          if (text.length <= 30 && (text.includes("continue") || text.includes("继续"))) {
            return btn;
          }
        } catch {}
      }

      await this.page.waitForTimeout(200);
    }

    // Debug: log visible button texts so we can see what's on screen
    const buttonTexts = await this.page.evaluate(() =>
      [...document.querySelectorAll('button, [role="button"]')]
        .map((b) => (b.innerText || "").trim())
        .filter((t) => t.length > 0)
    );
    if (buttonTexts.length > 0) {
      console.log("🔍 No Continue button found. Buttons on page:", buttonTexts.slice(0, 15));
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
