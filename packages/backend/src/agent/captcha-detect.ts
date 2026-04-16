/**
 * captcha-detect.ts
 *
 * A stringified IIFE we ship to `agent-browser eval` to decide whether the
 * currently-open page is blocked behind some kind of bot/captcha wall. The
 * runner polls this snippet after every navigation command so the stealth
 * extension has a chance to clear Cloudflare interstitials before the agent
 * starts reading the page.
 *
 * Returns one of three values:
 *   'interstitial' — Cloudflare JS challenge ("Just a moment..."). The stealth
 *                    extension can clear these; the runner should poll and wait.
 *   'captcha'      — An actual captcha widget (reCAPTCHA, hCaptcha, Turnstile,
 *                    etc.) that requires human intervention. The runner should
 *                    request a takeover immediately.
 *   'clear'        — No challenge detected.
 *
 * IMPORTANT: this runs as a string inside Chrome, NOT in Node. Keep it
 * ES5-flavoured so it stays safe if the agent-browser build ever targets an
 * older chromium.
 */

export const CAPTCHA_DETECT_JS = `(function() {
  var title = (document.title || '').toLowerCase();

  // Cloudflare JS interstitials — the stealth extension can clear these.
  var cfTitlePatterns = [
    'just a moment',           // Cloudflare interstitial (EN)
    'un momento',              // CF Spanish
    'un instant',              // CF French
    'einen moment',            // CF German
    'checking your browser',   // CF older / generic anti-bot
    'please wait',             // generic "please wait while we check"
  ];
  var cfSelectors = [
    '#challenge-stage',
    '#challenge-running',
    '#cf-challenge-running',
    '.cf-browser-verification',
    '.cf-im-under-attack',
  ];
  for (var i = 0; i < cfTitlePatterns.length; i++) {
    if (title.indexOf(cfTitlePatterns[i]) !== -1) return 'interstitial';
  }
  for (var j = 0; j < cfSelectors.length; j++) {
    if (document.querySelector(cfSelectors[j])) return 'interstitial';
  }

  // Actual captcha widgets — need human intervention.
  var captchaSelectors = [
    'iframe[src*="captcha-delivery"]',        // DataDome
    'iframe[src*="geo.captcha"]',             // DataDome geo
    'iframe[src*="recaptcha"]',               // reCaptcha v2/v3
    'iframe[src*="hcaptcha"]',                // hCaptcha
    'iframe[src*="challenges.cloudflare"]',   // Cloudflare Turnstile
    'iframe[src*="arkoselabs"]',              // Arkose FunCaptcha
    'iframe[src*="funcaptcha"]',
    '.g-recaptcha',
    '.h-captcha',
    '[class*="captcha"]',
    '#px-captcha',                            // PerimeterX / HUMAN
  ];
  // "Attention Required" is a CF WAF block — not a JS interstitial, needs human.
  if (title.indexOf('attention required') !== -1) return 'captcha';
  for (var k = 0; k < captchaSelectors.length; k++) {
    if (document.querySelector(captchaSelectors[k])) return 'captcha';
  }
  return 'clear';
})()`;
