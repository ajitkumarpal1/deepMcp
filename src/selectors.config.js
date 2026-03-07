/**
 * DeepSeek chat UI selectors. If the site changes, update these
 * instead of editing deepseek-browser.js. Verify with F12 in browser.
 *
 * Generation detection strategy (as of 2026-03):
 *   While DeepSeek is generating, the SEND button gets:
 *     class="... ds-icon-button--disabled"  aria-disabled="true"
 *   When done, those are removed.
 *   deepseek-browser.js uses waitForFunction on this attribute — no selector needed.
 *
 * sendingSpinner: kept as reference only (not used in main flow).
 */
module.exports = {
  /** Kept for reference — the stop button appears while generating but is unreliable
   *  to detect because the send button shares the same base classes. Not used. */
  stopButtonSelectors: [
    'div.ds-icon-button--sizing-container[role="button"][aria-disabled="false"]:not(.ds-icon-button--disabled)',
    '[aria-label="Stop"]',
  ],
  /** aria-busy fallback — not used in main flow */
  sendingSpinner: '[aria-busy="true"]',
  continueSelectors: [
    // Most specific first — actual DeepSeek button:
    // <button class="ds-basic-button--outlined"><span>Continue</span></button>
    'button.ds-basic-button--outlined:has-text("Continue")',
    'button.ds-atom-button:has-text("Continue")',
    // Native CSS :has() + Playwright text selector
    '.ds-basic-button--outlined:has(span:text("Continue"))',
    '.ds-basic-button--outlined:has(span:text-is("Continue"))',
    // Generic Playwright text selectors
    'button:has-text("Continue")',
    'button:has-text("Continue generating")',
    'button:has-text("继续")',
    '[aria-label="Continue"]',
  ],
  responseContentSelectors: [
    ".ds-markdown",
    '[class*="markdown"]',
    '[class*="message-content"]',
    '[data-role="assistant"]',
  ],
};
