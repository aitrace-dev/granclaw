/**
 * stealth.ts
 *
 * Builds the agent-browser launch flags that hide automation fingerprints.
 *
 *   stealthArgv() returns an argv fragment for the `agent-browser` boot command:
 *
 *   --args --load-extension=<dir>
 *     Loads the GranClaw stealth MV3 extension. The extension content script
 *     runs at document_start in world=MAIN — before any page JS — patching
 *     navigator.webdriver, UA, plugins, WebGL, canvas, audio, and more.
 *     Works in Chrome 112+ new headless mode without a display (no Xvfb needed).
 *
 *   --args --enable-extensions
 *     Required to activate extension loading in headless mode.
 *
 *   --args --disable-blink-features=AutomationControlled
 *     Removes navigator.webdriver = true at the Chrome level, the #1 signal.
 *
 *   --executable-path <path>
 *     Uses real installed Chrome/Chromium instead of Playwright's bundled
 *     build (less fingerprinted).
 *
 * Override hooks:
 *   GRANCLAW_STEALTH_DISABLED=1           → no-op
 *   GRANCLAW_CHROME_PATH=/abs/path/chrome → force a specific binary
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// ── Extension dir ─────────────────────────────────────────────────────────────

/**
 * Resolve the stealth-extension directory across three layouts:
 *   - dev (tsx src):        packages/backend/src/browser/      → ../../assets/stealth-extension
 *   - backend standalone:   packages/backend/dist/browser/     → ../../assets/stealth-extension
 *   - cli bundled publish:  packages/cli/dist/backend/browser/ → ../assets/stealth-extension
 */
function resolveExtensionDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../assets/stealth-extension'),
    path.resolve(__dirname, '../assets/stealth-extension'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) return candidate;
  }
  return null;
}

export const STEALTH_EXTENSION_DIR = resolveExtensionDir();

// ── Chrome binary detection + UA derivation ───────────────────────────────────

let cachedChromePath: string | null | undefined;
function detectChromePath(): string | null {
  if (cachedChromePath !== undefined) return cachedChromePath;

  const override = process.env.GRANCLAW_CHROME_PATH || process.env.AGENT_BROWSER_CHROME_PATH;
  if (override && fs.existsSync(override)) {
    cachedChromePath = override;
    return override;
  }

  const candidates: string[] = (() => {
    switch (process.platform) {
      case 'darwin':
        return [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
          '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
        ];
      case 'linux':
        return [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
        ];
      case 'win32':
        return [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ];
      default:
        return [];
    }
  })();

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedChromePath = candidate;
      return candidate;
    }
  }
  cachedChromePath = null;
  return null;
}

/**
 * Detect the installed Chrome/Chromium version and return a non-headless UA string.
 * e.g. "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
 *
 * Returns null if Chrome can't be found or version can't be parsed.
 */
let cachedChromeUA: string | null | undefined;
function detectChromeUA(): string | null {
  if (cachedChromeUA !== undefined) return cachedChromeUA;

  const override = process.env.GRANCLAW_STEALTH_UA;
  if (override) { cachedChromeUA = override; return override; }

  const chromePath = detectChromePath();
  if (!chromePath) { cachedChromeUA = null; return null; }

  try {
    const output = execFileSync(chromePath, ['--version'], { encoding: 'utf8', timeout: 5000 });
    // "Chromium 147.0.7280.66 built on Debian..." or "Google Chrome 120.0.6099.109"
    const match = output.match(/(\d+)\.\d+\.\d+\.\d+/);
    if (!match) { cachedChromeUA = null; return null; }
    const major = match[1];
    const platform = process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
    cachedChromeUA = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
    return cachedChromeUA;
  } catch {
    cachedChromeUA = null;
    return null;
  }
}

// ── argv builder ──────────────────────────────────────────────────────────────

/**
 * Return the argv fragment for the `agent-browser` boot command.
 * Spread into the argv before the subcommand, e.g.:
 *   agent-browser --session <id> ...stealthArgv() open about:blank
 */
export function stealthArgv(): string[] {
  if (process.env.GRANCLAW_STEALTH_DISABLED === '1') return [];

  const argv: string[] = [
    '--args', '--disable-blink-features=AutomationControlled',
    '--args', '--enable-extensions',
    // Enable the V8 heap memory API (performance.memory) — disabled by default in headless.
    '--args', '--enable-precise-memory-info',
  ];

  // Override the UA at the Chrome level. navigator.userAgent in Chrome 120+ has
  // a non-configurable prototype property that JS Object.defineProperty cannot
  // patch — the only reliable fix is to set it before the browser starts.
  const ua = detectChromeUA();
  if (ua) {
    argv.push('--args', `--user-agent=${ua}`);
  }

  if (STEALTH_EXTENSION_DIR) {
    argv.push('--args', `--load-extension=${STEALTH_EXTENSION_DIR}`);
    argv.push('--args', `--disable-extensions-except=${STEALTH_EXTENSION_DIR}`);
  }

  const chrome = detectChromePath();
  if (chrome) {
    argv.push('--executable-path', chrome);
  }

  return argv;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** @internal */
export function __resetStealthCacheForTests(): void {
  cachedChromePath = undefined;
  cachedChromeUA = undefined;
}
