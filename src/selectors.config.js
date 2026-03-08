/**
 * DeepSeek chat UI selectors. If the site changes, update these
 * instead of editing deepseek-browser.js. Verify with F12 in browser.
 *
 * Response-done detection: we ask DeepSeek to end every response with RESPONSE_COMPLETE_MARKER.
 * We poll the last message until it contains the marker, then we know the response is done.
 */
module.exports = {
  /** DeepSeek is instructed to end every full response with this exact line. We wait for it so we never assume done too early. */
  responseCompleteMarker: "[RESPONSE_COMPLETE]",
  /**
   * Selectors used ONLY to detect when generation has finished (fallback when
   * [RESPONSE_COMPLETE] marker is not seen). NOT used for clicking — clicking
   * is handled by _clickSendButton() via DOM traversal from the textarea.
   * Update if DeepSeek changes their UI (verify with F12 → Elements panel).
   */
  sendButtonSelectors: [
    '[aria-label="Send"]',
    '[aria-label="send"]',
    'button[type="submit"]',
    '.ds-icon-button--sizing-container[role="button"][aria-disabled="false"]',
  ],
  /** Selectors for "generating in progress" — send button has this while generating. */
  generatingSelector: '.ds-icon-button--disabled[aria-disabled="true"]',
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
