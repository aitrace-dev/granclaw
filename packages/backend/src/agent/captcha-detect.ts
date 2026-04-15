/**
 * captcha-detect.ts
 *
 * A stringified IIFE we ship to `agent-browser eval` to decide whether the
 * currently-open page is blocked behind some kind of bot/captcha wall. The
 * runner polls this snippet after every navigation command so CapMonster and
 * the stealth extension have a chance to clear the challenge before the
 * agent starts reading the page.
 *
 * It covers:
 *   - Cloudflare JS interstitials ("Just a moment...", "Checking your browser…",
 *     "Attention Required"), including the common localised titles.
 *   - Cloudflare managed-challenge DOM markers (#challenge-stage,
 *     #challenge-running, .cf-browser-verification, .cf-im-under-attack).
 *   - The classic widget iframes: reCaptcha, hCaptcha, Cloudflare Turnstile,
 *     DataDome, Arkose/FunCaptcha.
 *   - Inline widgets: .g-recaptcha, .h-captcha, [class*="captcha"].
 *   - PerimeterX / HUMAN bot check: #px-captcha.
 *
 * IMPORTANT: this runs as a string inside Chrome, NOT in Node. No ES features
 * newer than the detector's tested Chrome baseline, no TypeScript. Keep it
 * ES5-flavoured so it stays safe if the agent-browser build ever targets an
 * older chromium.
 */

export const CAPTCHA_DETECT_JS = `(function() {
  var title = (document.title || '').toLowerCase();
  var titlePatterns = [
    'just a moment',           // Cloudflare interstitial (EN)
    'un momento',              // CF Spanish
    'un instant',              // CF French
    'einen moment',            // CF German
    'checking your browser',   // CF older / generic anti-bot
    'attention required',      // CF WAF block page
    'please wait',             // generic "please wait while we check"
  ];
  for (var i = 0; i < titlePatterns.length; i++) {
    if (title.indexOf(titlePatterns[i]) !== -1) return 'captcha';
  }

  var selectors = [
    // Widget iframes
    'iframe[src*="captcha-delivery"]',        // DataDome
    'iframe[src*="geo.captcha"]',             // DataDome geo
    'iframe[src*="recaptcha"]',               // reCaptcha v2/v3
    'iframe[src*="hcaptcha"]',                // hCaptcha
    'iframe[src*="challenges.cloudflare"]',   // Cloudflare Turnstile
    'iframe[src*="arkoselabs"]',              // Arkose FunCaptcha
    'iframe[src*="funcaptcha"]',
    // Inline widgets
    '.g-recaptcha',
    '.h-captcha',
    '[class*="captcha"]',
    // Cloudflare interstitial / managed challenge
    '#challenge-stage',
    '#challenge-running',
    '#cf-challenge-running',
    '.cf-browser-verification',
    '.cf-im-under-attack',
    // PerimeterX / HUMAN
    '#px-captcha',
  ];
  for (var j = 0; j < selectors.length; j++) {
    if (document.querySelector(selectors[j])) return 'captcha';
  }
  return 'clear';
})()`;
