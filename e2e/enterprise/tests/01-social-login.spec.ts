/**
 * End-to-end happy path for the Social Logins / gologin extension:
 *
 *   1. Create an agent
 *   2. Activate gologin for that agent (creates a profile in the fake API)
 *   3. Start a LinkedIn login session — fake gologin launches Chromium,
 *      backend wires the CDP url
 *   4. "Log in" by connecting to that same CDP endpoint with Playwright
 *      and setting linkedin cookies (simulates what the user would do by
 *      typing into the real login form)
 *   5. POST /login-session/complete and verify cookieSync.ok=true
 *   6. Verify the fake GoLogin API received the cookies
 *   7. GET /status and verify linkedin appears in connectedPlatforms
 *   8. Smoke-check the frontend renders
 *
 * This is the test that would have caught the silent-swallow behaviour
 * before Option 2: if the cookie sync fails, the route now surfaces it in
 * the response body, and this test asserts `cookieSync.ok=true`.
 */
import { test, expect, chromium, type Browser } from '@playwright/test';

const BACKEND = 'http://localhost:3199';
const MOCK_API = 'http://localhost:4567';
const AGENT_ID = `e2e-gologin-${Date.now()}`;
const AGENT_NAME = 'E2E GoLogin Agent';

async function resetFakeApi(): Promise<void> {
  const res = await fetch(`${MOCK_API}/__state`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

async function fakeApiState(): Promise<{ profiles: Array<{ id: string; name: string; cookies: unknown[] }> }> {
  const res = await fetch(`${MOCK_API}/__state`);
  return res.json() as Promise<{ profiles: Array<{ id: string; name: string; cookies: unknown[] }> }>;
}

async function createAgent(): Promise<void> {
  // Remove any leftover from an interrupted run.
  await fetch(`${BACKEND}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
  const res = await fetch(`${BACKEND}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: AGENT_ID, name: AGENT_NAME }),
  });
  if (!res.ok) throw new Error(`create agent failed: ${res.status} ${await res.text()}`);
}

test.describe('gologin social login happy path', () => {
  let browser: Browser | null = null;

  test.beforeEach(async () => {
    await resetFakeApi();
    await createAgent();
  });

  test.afterEach(async () => {
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    await fetch(`${BACKEND}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
  });

  test('login, cookie sync succeeds, platform shows connected', async ({ page }) => {
    // ── Activate gologin for this agent ────────────────────────────────
    const activate = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/activate`,
      { method: 'POST' },
    );
    expect(activate.status).toBe(200);
    const { profileId } = await activate.json() as { profileId: string };
    expect(profileId).toBeTruthy();

    // Fake API should now hold the newly-created profile.
    const initialState = await fakeApiState();
    expect(initialState.profiles).toHaveLength(1);
    expect(initialState.profiles[0].id).toBe(profileId);
    expect(initialState.profiles[0].cookies).toHaveLength(0);

    // ── Start a LinkedIn login session ────────────────────────────────
    const startRes = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/login-session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'linkedin' }),
      },
    );
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json() as {
      sessionId: string; platform: string; platformUrl: string;
    };
    expect(startBody.platform).toBe('linkedin');
    expect(startBody.platformUrl).toContain('linkedin.com');

    // ── Simulate user login by injecting linkedin cookies over CDP ─────
    // In real life the user types credentials into the embedded browser;
    // for the test we attach to the same Chromium the service launched
    // (via the CDP url it already dropped at /tmp/granclaw-cdp-<id>.url)
    // and add cookies directly. The subsequent sync must pick them up.
    const cdpWsUrl = await readCdpWsUrl(AGENT_ID);
    expect(cdpWsUrl).toBeTruthy();

    browser = await chromium.connectOverCDP(cdpWsUrl);
    const ctx = browser.contexts()[0];
    expect(ctx).toBeDefined();
    // Inject test cookies by driving CDP Network.setCookie through the
    // same page target the service will later query with Network.getAllCookies.
    // This guarantees both sides see the same cookie store regardless of how
    // chromium scopes Network.getAllCookies at page-level targets.
    await injectCookiesViaCdp(cdpWsUrl, [
      { name: 'granclaw_e2e_session', value: 'fake-session-token',
        url: 'https://granclaw-test.com/' },
      { name: 'granclaw_e2e_id', value: 'user-42',
        url: 'https://granclaw-test.com/' },
    ]);

    // connectOverCDP's .close() disconnects the playwright client but
    // leaves the underlying Chromium running, so afterEach can safely
    // call it without terminating the browser the backend is using.

    // ── Complete the login session ────────────────────────────────────
    const completeRes = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/login-session/complete`,
      { method: 'POST' },
    );
    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json() as {
      connected: boolean; platform: string;
      cookieSync: { ok: boolean; cookieCount: number; error?: string };
    };
    expect(completeBody.connected).toBe(true);
    expect(completeBody.platform).toBe('linkedin');
    // Option 2 contract: sync result is surfaced, not swallowed.
    expect(completeBody.cookieSync.ok).toBe(true);
    expect(completeBody.cookieSync.cookieCount).toBeGreaterThanOrEqual(2);
    expect(completeBody.cookieSync.error).toBeUndefined();

    // ── Verify the fake GoLogin cloud received our injected cookies ─────
    const finalState = await fakeApiState();
    const profile = finalState.profiles.find(p => p.id === profileId);
    expect(profile).toBeDefined();
    const cookies = profile!.cookies as Array<{ name: string; domain: string; value: string }>;
    const sessionCookie = cookies.find(c => c.name === 'granclaw_e2e_session');
    const idCookie = cookies.find(c => c.name === 'granclaw_e2e_id');
    expect(sessionCookie?.value).toBe('fake-session-token');
    expect(idCookie?.value).toBe('user-42');

    // ── Verify /status reflects the connection ────────────────────────
    const statusRes = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/status`,
    );
    const statusBody = await statusRes.json() as {
      active: boolean; enabled: boolean;
      connectedPlatforms: Record<string, { connectedAt: string }>;
    };
    expect(statusBody.active).toBe(true);
    expect(statusBody.enabled).toBe(true);
    expect(statusBody.connectedPlatforms.linkedin).toBeDefined();

    // ── Lightweight UI smoke: dashboard renders ───────────────────────
    // We don't drive the Social Logins UI here because that's loaded from
    // the enterprise UI bundle which isn't part of the default dev build.
    // This at least confirms the frontend is alive alongside the backend.
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

/**
 * Read the CDP url the service wrote to /tmp/granclaw-cdp-<agentId>.url
 * during startLocalBrowser. The service already uses this file as the
 * handoff to agent subprocesses; the test is just another consumer.
 */
/**
 * Set cookies through CDP on the same page target the service will later
 * read from, using the raw WebSocket protocol. This avoids any mismatch
 * between Playwright's BrowserContext cookie jar and what
 * `Network.getAllCookies` returns when invoked on a page target.
 */
async function injectCookiesViaCdp(
  cdpWsUrl: string,
  cookies: Array<{ name: string; value: string; url: string }>,
): Promise<void> {
  const http = await import('http');
  const WebSocketMod = await import('ws');
  const WebSocket = (WebSocketMod as unknown as { default: typeof WebSocketMod.WebSocket }).default
    ?? (WebSocketMod as unknown as typeof WebSocketMod.WebSocket);
  const port = new URL(cdpWsUrl.replace('ws://', 'http://')).port;

  const targets = await new Promise<Array<{ type: string; webSocketDebuggerUrl: string }>>(
    (resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/json`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      }).on('error', reject);
    },
  );
  const pageUrl = targets.find(t => t.type === 'page')?.webSocketDebuggerUrl;
  if (!pageUrl) throw new Error('no page target available');

  await new Promise<void>((resolve, reject) => {
    const ws = new (WebSocket as unknown as { new (url: string): import('ws').WebSocket })(pageUrl);
    let id = 1;
    let replies = 0;
    const total = cookies.length;
    ws.on('open', () => {
      for (const c of cookies) {
        ws.send(JSON.stringify({
          id: id++, method: 'Network.setCookie',
          params: { name: c.name, value: c.value, url: c.url },
        }));
      }
    });
    ws.on('message', () => {
      replies += 1;
      if (replies >= total) { ws.close(); resolve(); }
    });
    ws.on('error', (err: Error) => reject(err));
    setTimeout(() => reject(new Error('CDP setCookie timeout')), 5000);
  });
}

async function readCdpWsUrl(agentId: string): Promise<string> {
  const fs = await import('fs');
  const p = `/tmp/granclaw-cdp-${agentId}.url`;
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`CDP url file ${p} did not appear`);
}
