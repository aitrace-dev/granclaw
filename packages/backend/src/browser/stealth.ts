/**
 * stealth.ts
 *
 * Central place where we build the agent-browser launch flags that hide
 * automation fingerprints. Two levers, both applied when available:
 *
 *   1. --extension <path>       loads the GranClaw stealth Chrome extension
 *                               which patches navigator.webdriver and friends
 *                               at document_start, before any page script runs.
 *
 *   2. --executable-path <path> points agent-browser at the user's real
 *                               Google Chrome install (macOS/Linux/Windows)
 *                               instead of the Chromium it downloads itself.
 *                               Real Chrome is less flagged by Google/Cloudflare
 *                               than Chromium for generic fingerprint reasons.
 *
 * Both are best-effort: if the extension directory is missing or Chrome isn't
 * installed we simply skip that flag. Callers always get back a flat argv
 * fragment they can spread into their existing spawn line.
 *
 * Override hooks for users who want to pin a specific Chrome:
 *   GRANCLAW_STEALTH_DISABLED=1           → no flags at all
 *   GRANCLAW_CHROME_PATH=/abs/path/chrome → force a specific binary
 */

import fs from 'fs';
import path from 'path';

/**
 * Resolve the stealth-extension directory across three layouts:
 *
 *   - dev (tsx src):        packages/backend/src/browser/      → ../../assets/stealth-extension
 *   - backend standalone:   packages/backend/dist/browser/     → ../../assets/stealth-extension
 *   - cli bundled publish:  packages/cli/dist/backend/browser/ → ../../assets/stealth-extension
 *                                                              OR ../assets/stealth-extension
 *
 * We probe both candidates and take the first that exists so the helper is
 * layout-agnostic. Callers fall back gracefully when none resolve.
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

const STEALTH_EXTENSION_DIR = resolveExtensionDir();

/**
 * Probe a list of well-known Chrome install paths and return the first that
 * exists. Resolved once per process to keep the per-launch cost at zero.
 */
let cachedChromePath: string | null | undefined;
function detectChromePath(): string | null {
  if (cachedChromePath !== undefined) return cachedChromePath;

  // GRANCLAW_CHROME_PATH takes priority; fall back to the agent-browser env
  // var so Docker containers (which set AGENT_BROWSER_CHROME_PATH=/usr/bin/chromium)
  // automatically point stealth at the same binary agent-browser will use.
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
 * Return the argv fragment to pass to `agent-browser` on the command that
 * boots the daemon. agent-browser ignores launch flags on subsequent calls
 * to an already-running daemon, so these must land on the first command.
 *
 * The caller splices the result into its own argv — e.g.:
 *
 *   const argv = ['--session', agentId, ...stealthArgv(), 'open', url];
 */
export function stealthArgv(): string[] {
  // Re-enabled 2026-04-14: UA/deviceMemory patches added, AGENT_BROWSER_CHROME_PATH
  // wired up so Docker containers automatically use the in-place Chromium.
  // Set GRANCLAW_STEALTH_DISABLED=1 to opt out entirely.
  if (process.env.GRANCLAW_STEALTH_DISABLED === '1') return [];

  const argv: string[] = [];

  if (STEALTH_EXTENSION_DIR) {
    argv.push('--extension', STEALTH_EXTENSION_DIR);
  }

  const chrome = detectChromePath();
  if (chrome) {
    argv.push('--executable-path', chrome);
  }

  return argv;
}

/**
 * Test-only hook to reset the Chrome-path cache between tests.
 * @internal
 */
export function __resetStealthCacheForTests(): void {
  cachedChromePath = undefined;
}

export { STEALTH_EXTENSION_DIR };
