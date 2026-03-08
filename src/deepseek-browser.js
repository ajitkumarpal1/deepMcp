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
    this._askUserResponseCompleted = options.askUserResponseCompleted || null;
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
    const marker = selectorsConfig.responseCompleteMarker;
    const markerTimeout = 300000; // 5 min
    const pollMs = 1500;

    // Primary: wait for DeepSeek to output [RESPONSE_COMPLETE] at the end so we never assume done too early.
    const deadline = Date.now() + markerTimeout;
    while (Date.now() < deadline) {
      const continueBtn = await this._findContinueButton();
      if (continueBtn) {
        console.log("\n🔄 Continue button found, clicking...");
        await continueBtn.click();
        await this.page.waitForTimeout(1500);
        continue;
      }
      const raw = await this._extractLastResponse();
      if (raw && raw.includes(marker)) {
        return this._stripResponseCompleteMarker(raw, marker);
      }
      await this.page.waitForTimeout(pollMs);
    }

    // Timeout: marker not seen. If user prompt is set, ask; else fall back to send-button.
    if (this._askUserResponseCompleted) {
      const done = await this._askUserResponseCompleted();
      if (done) {
        const continueBtn = await this._findContinueButton();
        if (continueBtn) {
          await continueBtn.click();
          await this.page.waitForTimeout(1500);
          return await this._waitForResponse();
        }
        const raw = await this._extractLastResponse();
        return this._stripResponseCompleteMarker(raw || "", marker);
      }
      return await this._waitForResponse();
    }

    // Fallback: send button visible and no Continue.
    const sendSelectors = selectorsConfig.sendButtonSelectors;
    try {
      await this.page.waitForFunction(
        ({ sendSelectors }) => {
          const isVisible = (el) => el && el.offsetParent !== null;
          const sendVisible = sendSelectors.some((sel) => {
            try {
              const el = document.querySelector(sel);
              return isVisible(el);
            } catch {
              return false;
            }
          });
          const hasContinue = [...document.querySelectorAll("button, [role=\"button\"]")].some(
            (b) => {
              const t = (b.innerText || "").trim().toLowerCase();
              return t.length <= 30 && (t.includes("continue") || t.includes("继续"));
            }
          );
          return sendVisible && !hasContinue;
        },
        { sendSelectors },
        { timeout: 60000, polling: 300 }
      );
    } catch {
      // use whatever we have
    }
    await this.page.waitForTimeout(1000);
    const continueBtn = await this._findContinueButton();
    if (continueBtn) {
      await continueBtn.click();
      await this.page.waitForTimeout(1500);
      return await this._waitForResponse();
    }
    const raw = await this._extractLastResponse();
    return this._stripResponseCompleteMarker(raw || "", marker);
  }

  _stripResponseCompleteMarker(text, marker) {
    if (!text || !marker) return text;
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp("\\s*" + escaped + "\\s*$"), "").trimEnd();
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
    const raw = await this.page.evaluate((candidates) => {
      for (const sel of candidates) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          return els[els.length - 1].innerText || "";
        }
      }
      return "";
    }, candidates);
    return this._stripUIButtonLabels(raw);
  }

  /** Remove DeepSeek UI labels (Copy, Download, Run, etc.) that get included in innerText. */
  _stripUIButtonLabels(text) {
    if (!text || typeof text !== "string") return text;
    const buttonOnly = /^\s*(Copy|Download|Run|复制|下载|运行)(\s+(Copy|Download|Run|复制|下载|运行))*\s*$/i;
    return text
      .split("\n")
      .filter((line) => !buttonOnly.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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
