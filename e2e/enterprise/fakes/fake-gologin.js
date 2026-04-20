/**
 * Fake gologin SDK — matches the subset of the real gologin contract that
 * service.ts relies on. Launches a real Chromium (Playwright's bundled one)
 * with --remote-debugging-port so that the service's CDP helpers receive
 * a genuine protocol endpoint.
 *
 * Contract:
 *   new GoLogin({ token, profile_id, ... })
 *   await gl.start()  -> { wsUrl }
 *   await gl.stop()
 *
 * Module is CommonJS. The service consumes via
 *   require('gologin').default ?? require('gologin')
 * so we export both module.exports (the class) and module.exports.default.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForCdp(port, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const data = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (data && data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`fake-gologin: CDP endpoint did not come up on port ${port}`);
}

class FakeGoLogin {
  constructor(opts) { this.opts = opts || {}; this.proc = null; }

  async start() {
    const port = await freePort();
    const exe = chromium.executablePath();
    // Match the real Orbita launch flags enough that headless Chromium is
    // usable as a CDP target; nothing here needs to replicate the anti-bot
    // stealth behaviour because the test doesn't exercise it.
    this.proc = spawn(exe, [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      'about:blank',
    ], { stdio: 'ignore', detached: false });

    this.proc.on('error', (err) => {
      console.error('[fake-gologin] chromium spawn error:', err);
    });

    const wsUrl = await waitForCdp(port);
    this.wsUrl = wsUrl;
    this.port = port;
    return { wsUrl };
  }

  async stop() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }
}

module.exports = FakeGoLogin;
module.exports.default = FakeGoLogin;
