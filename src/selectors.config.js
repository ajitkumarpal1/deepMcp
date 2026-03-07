/**
 * DeepSeek chat UI selectors. If the site changes, update these
 * instead of editing deepseek-browser.js. Verify with F12 in browser.
 *
 * sendingSpinner: Optional. Selector for an element visible while the send/response
 * is in progress (e.g. spinner on send button). When it disappears, response is done.
 * Set to empty string to use Stop button + polling only.
 */
module.exports = {
  // The square stop button visible WHILE DeepSeek is generating.
  // Actual HTML: <div class="ds-icon-button ds-icon-button--l ds-icon-button--sizing-container" role="button">
  // Try these in order — first one that appears wins.
  stopButtonSelectors: [
    'div.ds-icon-button--sizing-container[role="button"]',
    'div.ds-icon-button--l[role="button"]',
    '[aria-label="Stop"]',
    '[aria-label="stop"]',
  ],
  /** Fallback: aria-busy on any ancestor means still generating */
  sendingSpinner: '[aria-busy="true"]',
  continueSelectors: [
    // Actual DeepSeek button: <button class="ds-basic-button--outlined"><span>Continue</span>
    'button.ds-basic-button--outlined:has-text("Continue")',
    'button.ds-atom-button:has-text("Continue")',
    '.ds-basic-button--outlined:has(span:text("Continue"))',
    // Generic fallbacks
    'button:has-text("Continue")',
    'button:has-text("继续")',
    '[aria-label="Continue"]',
    'button:has-text("Continue generating")',
  ],
  responseContentSelectors: [
    ".ds-markdown",
    '[class*="markdown"]',
    '[class*="message-content"]',
    '[data-role="assistant"]',
  ],
};
