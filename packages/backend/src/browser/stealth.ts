/**
 * stealth.ts
 *
 * Builds the agent-browser launch flags that hide automation fingerprints.
 *
 *   stealthArgv() returns an argv fragment for the `agent-browser` boot command:
 *
 *   --extension <dir>
 *     Loads the GranClaw stealth MV3 extension (repeatable). The extension
 *     content script runs at document_start in world=MAIN — before any page
 *     JS — patching navigator.webdriver, UA, plugins, WebGL, canvas, audio.
 *     MUST use --extension (not --args --load-extension=…): agent-browser's
 *     --args flag is NOT repeatable and silently drops all but the LAST value,
 *     which is how the stealth extension was leaking in production.
 *
 *   --args "--disable-blink-features=AutomationControlled,--headless=new,…"
 *     ALL chromium flags must live inside a SINGLE --args value, comma-joined.
 *     agent-browser collapses repeated --args to the last one and splits each
 *     value on commas before forwarding to Chrome. --headless=new is required
 *     here because agent-browser does not auto-add it when --extension is set.
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
import os from 'os';
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

// ── CapMonster extension ──────────────────────────────────────────────────────

/**
 * Resolve the CapMonster extension directory (bundled in assets).
 * Returns null if not found.
 */
function resolveCapmonsterExtensionDir(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../assets/capmonster-extension'),
    path.resolve(__dirname, '../assets/capmonster-extension'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) return candidate;
  }
  return null;
}

const CAPMONSTER_BASE_DIR = resolveCapmonsterExtensionDir();

/**
 * Return a CapMonster extension directory pre-configured with the given API key.
 * Writes a patched copy to os.tmpdir() so the base assets stay clean.
 * Result is cached per process — re-patched only if the key changes.
 */
let _patchedCapmonsterDir: string | null = null;
let _patchedCapmonsterKey: string | null = null;

export function capmonsterExtensionDir(apiKey: string): string | null {
  if (!CAPMONSTER_BASE_DIR) return null;
  if (_patchedCapmonsterDir && _patchedCapmonsterKey === apiKey) {
    return _patchedCapmonsterDir;
  }
  try {
    const dest = path.join(os.tmpdir(), 'granclaw-capmonster-ext');
    // Copy base extension
    fs.cpSync(CAPMONSTER_BASE_DIR, dest, { recursive: true });
    // Patch defaultSettings.json with the API key
    const settingsPath = path.join(dest, 'defaultSettings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      settings.clientKey = apiKey;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
    _patchedCapmonsterDir = dest;
    _patchedCapmonsterKey = apiKey;
    return dest;
  } catch {
    return null;
  }
}

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

export interface StealthOptions {
  /** HTTP/SOCKS proxy URL, e.g. "http://user:pass@host:port". Falls back to GRANCLAW_PROXY env var. */
  proxy?: string;
  /** CapMonster Cloud API key for automatic CAPTCHA solving. Falls back to CAPMONSTER_KEY env var. */
  capmonsterKey?: string;
  /**
   * Emit --headless=new inside --args. Default true (daemon boot for agent work).
   * Set false when the caller also passes --headed (headed preview previews in
   * the orchestrator) — the two modes conflict and Chrome refuses to launch.
   */
  headless?: boolean;
}

/**
 * Return the argv fragment for the `agent-browser` boot command.
 * Spread into the argv before the subcommand, e.g.:
 *   agent-browser --session <id> ...stealthArgv(options) open about:blank
 */
export function stealthArgv(options: StealthOptions = {}): string[] {
  if (process.env.GRANCLAW_STEALTH_DISABLED === '1') return [];

  const argv: string[] = [];

  // All Chromium command-line switches MUST live inside a single --args value.
  // agent-browser's --args flag is NOT repeatable: only the LAST value survives,
  // and that value is comma-split before being forwarded to Chrome. Emitting
  // several --args flags was how every stealth switch except the last silently
  // vanished in production, leaving navigator.webdriver detectable.
  const chromeFlags: string[] = [
    '--disable-blink-features=AutomationControlled',
    // V8 heap memory API (performance.memory) — disabled by default in headless.
    '--enable-precise-memory-info',
  ];

  // agent-browser does not auto-add --headless=new once --extension is set,
  // so headless contexts must request it explicitly. Headed previews must NOT
  // include it (the orchestrator also passes --headed and Chrome refuses both).
  if (options.headless !== false) {
    chromeFlags.push('--headless=new');
  }

  argv.push('--args', chromeFlags.join(','));

  // Override the UA using agent-browser's dedicated --user-agent flag.
  // navigator.userAgent in Chrome 120+ has a non-configurable prototype
  // property that JS Object.defineProperty cannot patch, so the only reliable
  // fix is to set it at the browser level. We use the top-level flag rather
  // than --args because --args values are comma-split and a UA string contains
  // commas/spaces that would be mis-parsed.
  const ua = detectChromeUA();
  if (ua) {
    argv.push('--user-agent', ua);
  }

  // Extensions go through agent-browser's dedicated (repeatable) --extension
  // flag — NOT via --args --load-extension=… which is silently dropped by the
  // single-value --args collapse described above.
  if (STEALTH_EXTENSION_DIR) {
    argv.push('--extension', STEALTH_EXTENSION_DIR);
  }

  const capmonsterKey = options.capmonsterKey
    || process.env.CAPMONSTER_KEY
    || process.env.CAPMONSTER_API_KEY;
  const capmonsterEnabled = process.env.CAPMONSTER_ENABLED !== 'false';
  if (capmonsterKey && capmonsterEnabled) {
    const capmonsterDir = capmonsterExtensionDir(capmonsterKey);
    if (capmonsterDir) argv.push('--extension', capmonsterDir);
  }

  const chrome = detectChromePath();
  if (chrome) {
    argv.push('--executable-path', chrome);
  }

  // Route browser traffic through the agent's proxy if configured
  const proxy = options.proxy || process.env.GRANCLAW_PROXY;
  if (proxy) {
    argv.push('--proxy', proxy);
  }

  return argv;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** @internal */
export function __resetStealthCacheForTests(): void {
  cachedChromePath = undefined;
  cachedChromeUA = undefined;
}
