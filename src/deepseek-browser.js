const { chromium }    = require("playwright");
const config          = require("./config");
const selectorsConfig = require("./selectors.config");

// Session stored in user home directory — never inside the project root.
const SESSION_PATH = config.SESSION_PATH;

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
      console.log("Log in to DeepSeek in the browser, then press Enter in this terminal...");
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

    // Step 1: Focus the textarea
    const textarea = await this.page.waitForSelector("textarea");
    await textarea.click();

    // Step 2: Set the value in a way React actually registers.
    // fill() sets DOM .value but React tracks state separately via synthetic events.
    // Using the native HTMLTextAreaElement setter + dispatching an InputEvent
    // forces React to sync its internal state and enable the send button.
    // NOTE: use textarea.evaluate(fn, arg) — page.evaluate only accepts one arg after fn.
    await textarea.evaluate((el, val) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      setter.call(el, val);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, message);

    // Step 3: Click the send button explicitly.
    // Pressing Enter adds a newline in DeepSeek's textarea — it does NOT send.
    const sent = await this._clickSendButton();
    if (!sent) {
      // Last resort fallback
      console.warn("⚠️  Send button not found — trying Enter key as fallback.");
      await this.page.keyboard.press("Enter");
    }

    const response = await this._waitForResponse();
    console.log(`\n✅ Response received! (${response.length} chars)`);

    return response;
  }

  /**
   * Finds and clicks the send button after text has been entered.
   *
   * WHY the old approach failed:
   *   page.$('.ds-icon-button--sizing-container[role="button"]') matches MULTIPLE
   *   icon buttons (search, think, upload, send) and returns the FIRST one — which
   *   is NOT the send button. Clicking it does nothing visible.
   *
   * NEW approach — traverse up the DOM from the textarea:
   *   The send button is always structurally next to the textarea in the DOM tree.
   *   Walking up from the textarea and looking for the last enabled SVG button
   *   in the nearest container reliably finds the correct button regardless of
   *   class names (which change when DeepSeek redeploys).
   */
  async _clickSendButton() {
    // Give React one render cycle to process the InputEvent and flip
    // the send button from aria-disabled="true" to aria-disabled="false".
    await this.page.waitForTimeout(400);

    // ── Strategy 1: DOM traversal from the textarea ──────────────────────────
    // Walk up the DOM until we find a container that holds the send button.
    const clicked = await this.page.evaluate(() => {
      const textarea = document.querySelector('textarea');
      if (!textarea) return false;

      let container = textarea.parentElement;
      for (let depth = 0; depth < 8; depth++) {
        if (!container || container === document.body) break;

        const candidates = [...container.querySelectorAll('[role="button"]')].filter(btn => {
          if (btn.getAttribute('aria-disabled') === 'true') return false;
          if (!btn.querySelector('svg')) return false;                        // must be an icon button
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          return label !== 'stop' && !label.includes('continue');             // exclude Stop/Continue
        });

        if (candidates.length > 0) {
          // Send button is the LAST icon button in the input area
          candidates[candidates.length - 1].click();
          return true;
        }

        container = container.parentElement;
      }
      return false;
    });

    if (clicked) {
      console.log("✅ Send button clicked (DOM traversal)");
      return true;
    }

    // ── Strategy 2: Wait for enabled state then use page.click() ────────────
    // page.click() scrolls + retries; more reliable than elementHandle.click().
    const enabledSel = '.ds-icon-button--sizing-container[role="button"][aria-disabled="false"]';
    try {
      await this.page.waitForSelector(enabledSel, { timeout: 3000 });
      await this.page.click(enabledSel);
      console.log("✅ Send button clicked (CSS selector)");
      return true;
    } catch { /* not found within timeout */ }

    // ── Debug: print available buttons so the user can update selectors ──────
    const found = await this.page.evaluate(() =>
      [...document.querySelectorAll('[role="button"]')].map(b => ({
        cls:     b.className.slice(0, 60),
        label:   b.getAttribute('aria-label'),
        disabled: b.getAttribute('aria-disabled'),
        hasSvg:  !!b.querySelector('svg'),
      }))
    );
    console.log("⚠️  Send button not found. Buttons on page:", JSON.stringify(found.slice(0, 12), null, 2));

    return false;
  }

  async _startNewChat() {
    try {
      await this.page.goto("https://chat.deepseek.com", {
        waitUntil: "networkidle",
      });
      // Wait until the textarea is interactive before returning
      await this.page.waitForSelector("textarea", { state: "visible", timeout: 10000 });
    } catch (e) {
      console.warn("⚠️  Could not start new chat:", e.message);
    }
  }

  async _waitForResponse() {
    const marker  = selectorsConfig.responseCompleteMarker;
    const pollMs  = config.POLL_INTERVAL_MS;
    const deadline = Date.now() + config.RESPONSE_TIMEOUT_MS;

    // Allow DeepSeek a moment to start generating so the send button
    // transitions to disabled — this seeds the generationDetected flag.
    await this.page.waitForTimeout(2000);

    let generationDetected = false;

    while (Date.now() < deadline) {
      // ── 1. Handle "Continue" button (long responses are split) ─────────────
      const continueBtn = await this._findContinueButton();
      if (continueBtn) {
        console.log("\n🔄 Continue button found, clicking...");
        await continueBtn.click();
        await this.page.waitForTimeout(1500);
        generationDetected = true; // more content is coming
        continue;
      }

      // ── 2. Extract current response text ───────────────────────────────────
      const raw = await this._extractLastResponse();

      // ── 3. Fast path: explicit [RESPONSE_COMPLETE] at end of response ──────
      if (raw && this._hasMarkerAtEnd(raw, marker)) {
        return this._stripResponseCompleteMarker(raw, marker);
      }

      // ── 4. Button-state detection — most reliable fallback ─────────────────
      // The send button is disabled while DeepSeek generates and re-enabled
      // when it finishes. Tracking that transition avoids a 5-min timeout.
      const isGenerating = await this._isSendButtonDisabled();

      if (isGenerating) {
        generationDetected = true;
      } else if (generationDetected && raw && raw.length > 20) {
        // Generation started and has now stopped — wait one extra poll for
        // any trailing characters, then return.
        await this.page.waitForTimeout(pollMs);
        const finalRaw = await this._extractLastResponse();
        return this._stripResponseCompleteMarker(finalRaw || raw, marker);
      }

      await this.page.waitForTimeout(pollMs);
    }

    // ── 5. Timeout: ask user or return whatever we have ─────────────────────
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

    const raw = await this._extractLastResponse();
    return this._stripResponseCompleteMarker(raw || "", marker);
  }

  /**
   * Returns true when the send button (the SVG icon button nearest the textarea)
   * is in the disabled state — meaning DeepSeek is currently generating.
   */
  async _isSendButtonDisabled() {
    return await this.page.evaluate(() => {
      const textarea = document.querySelector('textarea');
      if (!textarea) return false;

      // Walk up from the textarea to find its input container, then look for
      // SVG icon buttons inside it (same logic as _clickSendButton).
      let container = textarea.parentElement;
      for (let depth = 0; depth < 8; depth++) {
        if (!container || container === document.body) break;
        const btns = [...container.querySelectorAll('[role="button"]')]
          .filter(btn => btn.querySelector('svg'));
        if (btns.length > 0) {
          // The send button is the last SVG button in the input area.
          const sendBtn = btns[btns.length - 1];
          return sendBtn.getAttribute('aria-disabled') === 'true';
        }
        container = container.parentElement;
      }
      return false;
    });
  }

  /**
   * Returns true only when the marker appears at the very end of the text on its
   * own line. Prevents false positives when the instructions (which describe the
   * marker) are echoed back inside DeepSeek's response.
   */
  _hasMarkerAtEnd(text, marker) {
    if (!text || !marker) return false;
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\n\\s*" + escaped + "\\s*$").test(text)
        || text.trimEnd() === marker;
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
