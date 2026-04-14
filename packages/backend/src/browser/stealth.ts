/**
 * stealth.ts
 *
 * Two mechanisms for hiding automation fingerprints:
 *
 *   1. stealthArgv()          — argv fragment for `agent-browser` launch.
 *                               Adds --executable-path when a real Chrome/Chromium
 *                               binary is available (real Chrome is less flagged
 *                               than the Playwright-bundled build).
 *
 *   2. injectStealthViaCdp()  — connects to the running browser via CDP and
 *                               calls Page.addScriptToEvaluateOnNewDocument with
 *                               the stealth.js patches. Also fires Runtime.evaluate
 *                               on the current page so the patches apply immediately,
 *                               not just on the next navigation.
 *                               Works in both headless (Docker) and headed (local)
 *                               mode — no display or extension loader required.
 *
 * Override hooks:
 *   GRANCLAW_STEALTH_DISABLED=1           → both mechanisms are no-ops
 *   GRANCLAW_CHROME_PATH=/abs/path/chrome → force a specific binary for --executable-path
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocket } from 'ws';

const execFileAsync = promisify(execFile);

// ── Extension dir (source of stealth.js) ──────────────────────────────────────

/**
 * Resolve the stealth-extension directory across three layouts:
 *
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

const STEALTH_EXTENSION_DIR = resolveExtensionDir();

// ── Chrome binary detection ───────────────────────────────────────────────────

let cachedChromePath: string | null | undefined;
function detectChromePath(): string | null {
  if (cachedChromePath !== undefined) return cachedChromePath;

  // GRANCLAW_CHROME_PATH takes priority; fall back to AGENT_BROWSER_CHROME_PATH
  // so Docker containers (AGENT_BROWSER_CHROME_PATH=/usr/bin/chromium) automatically
  // use the same binary that agent-browser itself is configured to use.
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

// ── argv builder ──────────────────────────────────────────────────────────────

/**
 * Return the argv fragment for the `agent-browser` command that boots the
 * daemon.
 *
 *  --executable-path   Use real Chrome when available (less flagged than
 *                      Playwright's bundled build).
 *  --args              Chrome-level launch flags:
 *                        --disable-blink-features=AutomationControlled
 *                          Removes navigator.webdriver = true, which is the
 *                          #1 bot-detection signal set by Playwright/CDP.
 *
 * The User-Agent is handled separately in prewarmStealthDaemon via a
 * two-phase boot (discover real UA → restart with --user-agent <patched>).
 */
export function stealthArgv(): string[] {
  if (process.env.GRANCLAW_STEALTH_DISABLED === '1') return [];

  const argv: string[] = ['--args', '--disable-blink-features=AutomationControlled'];

  const chrome = detectChromePath();
  if (chrome) {
    argv.push('--executable-path', chrome);
  }

  return argv;
}

// ── CDP stealth injection ─────────────────────────────────────────────────────

/**
 * Poll for the browser-level CDP WebSocket URL.
 *
 * @param retries How many attempts to make (default 8, ~2.4 s). Pass 1 for
 *                a fast single-shot check used by the background watcher.
 */
async function discoverCdpUrl(
  sessionId: string,
  workspaceDir: string,
  retries = 8,
): Promise<string | null> {
  const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
  for (let i = 0; i < retries; i++) {
    try {
      const { stdout } = await execFileAsync(bin, ['--session', sessionId, 'get', 'cdp-url'], {
        cwd: workspaceDir,
        timeout: 2000,
      });
      const url = stdout.trim();
      if (url.startsWith('ws://') || url.startsWith('wss://')) return url;
    } catch { /* daemon not ready yet */ }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/**
 * Fetch all page targets from the browser's /json/list endpoint.
 */
async function fetchPageTargets(
  browserCdpUrl: string,
): Promise<Array<{ webSocketDebuggerUrl: string }>> {
  return new Promise((resolve) => {
    const match = /^wss?:\/\/([^/]+)\//.exec(browserCdpUrl);
    if (!match) { resolve([]); return; }
    const host = match[1];
    const req = http.get(`http://${host}/json/list`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => {
        try {
          const targets = JSON.parse(body) as Array<{
            type: string;
            webSocketDebuggerUrl?: string;
          }>;
          resolve(
            targets
              .filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
              .map((t) => ({ webSocketDebuggerUrl: t.webSocketDebuggerUrl! })),
          );
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Open a CDP WebSocket to a single page target and:
 *   1. Override the User-Agent at the browser target level via
 *      Emulation.setUserAgentOverride — patches both HTTP headers and
 *      navigator.userAgent without relying on Chrome launch flags or JS
 *      property overrides (more reliable than both).
 *   2. Register the stealth script for all future navigations via
 *      Page.addScriptToEvaluateOnNewDocument.
 *   3. Run it immediately on the current document via Runtime.evaluate so
 *      patches are live without a reload.
 */
function injectIntoPage(wsUrl: string, script: string, userAgent?: string): Promise<void> {
  return new Promise((resolve) => {
    const cleanup = (ws: WebSocket) => { try { ws.close(); } catch { /* ignore */ } resolve(); };
    const timer = setTimeout(() => cleanup(ws), 5000);
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      // Patch UA at the CDP/browser level — overrides both HTTP User-Agent header
      // and navigator.userAgent. More reliable than --user-agent flag (only applies
      // at daemon boot) or JS Object.defineProperty (fails if property non-configurable).
      if (userAgent) {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Emulation.setUserAgentOverride',
          params: {
            userAgent,
            acceptLanguage: 'en-US,en;q=0.9',
            platform: 'Linux x86_64',
          },
        }));
      }
      ws.send(JSON.stringify({
        id: 2,
        method: 'Page.addScriptToEvaluateOnNewDocument',
        params: { source: script },
      }));
      ws.send(JSON.stringify({
        id: 3,
        method: 'Runtime.evaluate',
        params: { expression: script, returnByValue: false },
      }));
      setTimeout(() => { clearTimeout(timer); cleanup(ws); }, 400);
    });

    ws.on('error', () => { clearTimeout(timer); resolve(); });
    ws.on('close', () => { clearTimeout(timer); resolve(); });
  });
}

/**
 * Inject the stealth script into every open page of the agent's browser
 * session via CDP. Call this after the agent-browser daemon has started.
 *
 * @param userAgent  Patched UA string (HeadlessChrome → Chrome). When provided,
 *                   Emulation.setUserAgentOverride is sent to each page target so
 *                   both HTTP headers and navigator.userAgent are corrected.
 *
 * Best-effort: any error is swallowed so a CDP failure never breaks the
 * caller's main flow.
 */
export async function injectStealthViaCdp(
  sessionId: string,
  workspaceDir: string,
  userAgent?: string,
): Promise<void> {
  if (process.env.GRANCLAW_STEALTH_DISABLED === '1') return;
  if (!STEALTH_EXTENSION_DIR) return;

  const scriptPath = path.join(STEALTH_EXTENSION_DIR, 'stealth.js');
  if (!fs.existsSync(scriptPath)) return;

  // Resolve UA: explicit arg > env var set by prewarm > nothing
  const ua = userAgent || process.env.AGENT_BROWSER_USER_AGENT || undefined;

  try {
    const script = fs.readFileSync(scriptPath, 'utf-8');
    const cdpUrl = await discoverCdpUrl(sessionId, workspaceDir);
    if (!cdpUrl) return;

    const pages = await fetchPageTargets(cdpUrl);
    await Promise.all(pages.map((p) => injectIntoPage(p.webSocketDebuggerUrl, script, ua)));
    console.log(`[stealth] injected into ${pages.length} page(s) for session "${sessionId}"${ua ? ' (UA override applied)' : ''}`);
  } catch (err) {
    console.warn(`[stealth] CDP injection failed for "${sessionId}":`, err);
  }
}

// ── Daemon pre-warm ───────────────────────────────────────────────────────────

/**
 * Fetch the raw User-Agent string from the browser's CDP /json/version endpoint.
 * This reads the actual Chrome UA before any JS patches touch navigator.userAgent.
 */
async function fetchRawBrowserUA(cdpUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const match = /^wss?:\/\/([^/]+)\//.exec(cdpUrl);
    if (!match) { resolve(''); return; }
    const host = match[1];
    const req = http.get(`http://${host}/json/version`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => {
        try {
          const ua = (JSON.parse(body) as Record<string, string>)['User-Agent'] ?? '';
          resolve(ua);
        } catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

/**
 * Pre-warm the agent's browser daemon and register stealth before any
 * agent navigation. Call this once at agent process startup for agents
 * that have the browser tool enabled.
 *
 * Two-phase boot:
 *   Phase 1 — Boot the daemon without a UA override to discover the real
 *              browser UA from /json/version (reading navigator.userAgent
 *              would give the JS-patched value, not the raw one).
 *   Phase 2 — Kill the daemon and restart it with:
 *                --user-agent <Chrome/X.Y.Z>  strips "HeadlessChrome"
 *                --args --disable-blink-features=AutomationControlled
 *                  removes navigator.webdriver = true for every page target
 *              Then inject Page.addScriptToEvaluateOnNewDocument so the
 *              JS stealth patches (WebGL, plugins, permissions…) apply to
 *              all subsequent navigations on the initial page target.
 *
 * Chrome-level flags apply globally to every page target the daemon creates,
 * so they survive agent-browser open commands that spawn new targets.
 */
export async function prewarmStealthDaemon(
  sessionId: string,
  workspaceDir: string,
): Promise<void> {
  if (process.env.GRANCLAW_STEALTH_DISABLED === '1') return;

  const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
  const profileDir = path.join(workspaceDir, '.browser-profile');
  const uaCachePath = path.join(profileDir, 'ua.txt');

  // ── UA cache: skip Phase 1 when the patched UA was already discovered ─────
  // prewarmStealthDaemon writes the patched UA to <workspace>/.browser-profile/ua.txt
  // after Phase 1 so subsequent backend restarts skip the extra boot cycle.
  let patchedUA = '';
  try {
    const cached = fs.readFileSync(uaCachePath, 'utf-8').trim();
    if (cached.startsWith('Mozilla/')) patchedUA = cached;
  } catch { /* file absent — fall through to Phase 1 */ }

  if (!patchedUA) {
    // ── Phase 1: boot daemon to discover the real browser UA ─────────────────
    try {
      await execFileAsync(
        bin,
        ['--session', sessionId, 'open', 'about:blank'],
        { cwd: workspaceDir, timeout: 15000 },
      );
    } catch {
      return; // No Chrome / wrong env — skip silently.
    }

    const cdpUrl = await discoverCdpUrl(sessionId, workspaceDir);
    if (cdpUrl) {
      const rawUA = await fetchRawBrowserUA(cdpUrl);
      if (rawUA.includes('HeadlessChrome/')) {
        patchedUA = rawUA.replace('HeadlessChrome/', 'Chrome/');
        // Persist so the next backend restart skips Phase 1.
        try {
          fs.mkdirSync(profileDir, { recursive: true });
          fs.writeFileSync(uaCachePath, patchedUA, 'utf-8');
        } catch { /* best effort */ }
      }
    }

    // Kill the Phase-1 daemon so we can restart it with corrected launch flags.
    try {
      await execFileAsync(bin, ['--session', sessionId, 'close', '--all'],
        { cwd: workspaceDir, timeout: 5000 });
    } catch { /* ignore — daemon may already be gone */ }
  }

  // ── Phase 2: restart with stealth Chrome flags ────────────────────────────
  // stealthArgv() includes --args --disable-blink-features=AutomationControlled
  // (fixes navigator.webdriver) and --executable-path when real Chrome is found.
  // Persist the patched UA as a process-level env var so that every subsequent
  // agent-browser call in this process (including startBrowserRecording's
  // `record start`) inherits the correct UA even if the daemon restarts.
  if (patchedUA) process.env.AGENT_BROWSER_USER_AGENT = patchedUA;

  const launchArgs = ['--session', sessionId, ...stealthArgv()];
  if (patchedUA) launchArgs.push('--user-agent', patchedUA);
  launchArgs.push('open', 'about:blank');

  try {
    await execFileAsync(bin, launchArgs, { cwd: workspaceDir, timeout: 15000 });
  } catch {
    return;
  }

  // Daemon is up with correct flags. Register stealth JS for future navigations.
  // Pass patchedUA so Emulation.setUserAgentOverride is sent to every page target,
  // fixing navigator.userAgent at the CDP level regardless of --user-agent flag support.
  await injectStealthViaCdp(sessionId, workspaceDir, patchedUA || undefined);
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** @internal */
export function __resetStealthCacheForTests(): void {
  cachedChromePath = undefined;
}

export { STEALTH_EXTENSION_DIR };
