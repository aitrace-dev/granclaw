/**
 * End-to-end verification of the *handoff* to the agent-browser tool:
 *
 *   1. Activate gologin for an agent
 *   2. Start a LinkedIn login session → Orbita boots, CDP url lands in
 *      `/tmp/granclaw-cdp-<agentId>.url`
 *   3. Inject login cookies over CDP
 *   4. Complete the login session (periodic sync ends; Orbita stays alive)
 *   5. ── THE THING THIS TEST VERIFIES ──
 *      Simulate what `agent-browser --cdp <port> --session <agentId>` does
 *      on the next tool call: a *fresh* CDP client attaches to the same
 *      Orbita port and must still see the injected cookies.
 *
 * Why this matters: the unit tests prove the provider returns the right
 * `--cdp <port>` payload, and 01-social-login proves cookies reach the
 * GoLogin cloud. Neither proves the agent's next navigate call lands in
 * the *logged-in* Orbita. Without this test, a regression that drops
 * `browserCdpUrls` on `stopLoginSession` (or runs `gl.stop()` post-
 * complete) would only surface once a user tried to use the tool.
 */

import { test, expect, chromium, type Browser } from '@playwright/test';

const BACKEND = 'http://localhost:3199';
const MOCK_API = 'http://localhost:4567';
const AGENT_ID = `e2e-propagate-${Date.now()}`;
const AGENT_NAME = 'E2E Propagation Agent';

async function resetFakeApi(): Promise<void> {
  const res = await fetch(`${MOCK_API}/__state`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}

async function createAgent(): Promise<void> {
  await fetch(`${BACKEND}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
  const res = await fetch(`${BACKEND}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: AGENT_ID, name: AGENT_NAME }),
  });
  if (!res.ok) throw new Error(`create agent failed: ${res.status} ${await res.text()}`);
}

test.describe('agent-browser tool propagation after social login', () => {
  let injector: Browser | null = null;
  let attacher: Browser | null = null;

  test.beforeEach(async () => {
    await resetFakeApi();
    await createAgent();
  });

  test.afterEach(async () => {
    if (injector) { await injector.close().catch(() => {}); injector = null; }
    if (attacher) { await attacher.close().catch(() => {}); attacher = null; }
    await fetch(`${BACKEND}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
  });

  test('after login completes, a fresh agent-browser attach sees the login cookies', async () => {
    // ── Setup: activate + start login ───────────────────────────────────
    const activate = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/activate`,
      { method: 'POST' },
    );
    expect(activate.status).toBe(200);

    const startRes = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/login-session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'linkedin' }),
      },
    );
    expect(startRes.status).toBe(200);

    // ── Inject cookies into the currently-running Orbita over CDP ──────
    const cdpUrlBeforeComplete = await readCdpWsUrl(AGENT_ID);
    expect(cdpUrlBeforeComplete).toBeTruthy();
    await injectCookiesViaCdp(cdpUrlBeforeComplete, [
      { name: 'granclaw_prop_session', value: 'logged-in-token-xyz',
        url: 'https://granclaw-test.com/' },
      { name: 'granclaw_prop_userid', value: 'user-propagation-42',
        url: 'https://granclaw-test.com/' },
    ]);

    // ── Complete the login — this is where a regression could break
    //    propagation (e.g. if we ever called gl.stop() here). ───────────
    const completeRes = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/login-session/complete`,
      { method: 'POST' },
    );
    expect(completeRes.status).toBe(200);
    const completeBody = await completeRes.json() as {
      connected: boolean; cookieSync: { ok: boolean; cookieCount: number };
    };
    expect(completeBody.cookieSync.ok).toBe(true);

    // ── THE KEY ASSERTION ──────────────────────────────────────────────
    // Simulate `agent-browser --cdp <port> --session <agentId>` on the
    // next tool call: read the same CDP url file the resolver's tier-2
    // branch reads, open a FRESH connection, confirm we land in the same
    // Orbita and still see the logged-in cookies.

    // 1. The CDP url file must still exist (Orbita is alive).
    const cdpUrlAfterComplete = await readCdpWsUrl(AGENT_ID);
    expect(cdpUrlAfterComplete).toBe(cdpUrlBeforeComplete);

    // 2. A fresh client attach (as agent-browser would do) succeeds and
    //    sees the cookies via Network.getAllCookies.
    const freshCookies = await readCookiesViaCdp(cdpUrlAfterComplete);
    const session = freshCookies.find(c => c.name === 'granclaw_prop_session');
    const userId  = freshCookies.find(c => c.name === 'granclaw_prop_userid');
    expect(session?.value).toBe('logged-in-token-xyz');
    expect(userId?.value).toBe('user-propagation-42');

    // 3. A fresh Playwright CDP connection (another proxy for the agent
    //    tool attaching) can navigate inside the logged-in Orbita. If the
    //    browser had been torn down, connectOverCDP would throw.
    attacher = await chromium.connectOverCDP(cdpUrlAfterComplete);
    const ctx = attacher.contexts()[0];
    expect(ctx).toBeDefined();
    expect(ctx.pages().length).toBeGreaterThan(0);

    // 4. Status endpoint confirms the integration layer also remembers
    //    the platform is connected (belt-and-suspenders for the
    //    connectedPlatforms metadata path).
    const statusRes = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/status`,
    );
    const statusBody = await statusRes.json() as {
      connectedPlatforms: Record<string, { connectedAt: string }>;
    };
    expect(statusBody.connectedPlatforms.linkedin).toBeDefined();
  });

  test('second login session on the same agent reuses/replaces Orbita without losing cookies for the completed platform', async () => {
    // A stricter variant: run two back-to-back login sessions and verify
    // cookies set in the first are still retrievable (via GoLogin API,
    // even if the browser itself was re-launched). This exercises the
    // startLoginSession "existing session → stopLoginSession first" branch.
    await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/activate`,
      { method: 'POST' },
    );

    // First session — linkedin
    await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/login-session`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'linkedin' }),
      },
    );
    const cdp1 = await readCdpWsUrl(AGENT_ID);
    await injectCookiesViaCdp(cdp1, [
      { name: 'granclaw_first_run', value: 'first-value',
        url: 'https://granclaw-test.com/' },
    ]);
    const complete1 = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/login-session/complete`,
      { method: 'POST' },
    );
    expect(complete1.status).toBe(200);

    // Second session — another platform (reuses the Map path in startLoginSession)
    const start2 = await fetch(
      `${BACKEND}/integrations/gologin/agents/${AGENT_ID}/login-session`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'linkedin' }),
      },
    );
    expect(start2.status).toBe(200);

    // GoLogin cloud should still hold the cookies synced in session 1.
    const stateRes = await fetch(`${MOCK_API}/__state`);
    const state = await stateRes.json() as {
      profiles: Array<{ id: string; cookies: Array<{ name: string; value: string }> }>;
    };
    const allCookies = state.profiles.flatMap(p => p.cookies);
    const firstRun = allCookies.find(c => c.name === 'granclaw_first_run');
    expect(firstRun?.value).toBe('first-value');
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

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

/** Mirror of what `agent-browser --cdp <port> cookies` would do. */
async function readCookiesViaCdp(
  cdpWsUrl: string,
): Promise<Array<{ name: string; value: string; domain: string }>> {
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

  return await new Promise((resolve, reject) => {
    const ws = new (WebSocket as unknown as { new (url: string): import('ws').WebSocket })(pageUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    });
    ws.on('message', (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          id?: number;
          result?: { cookies: Array<{ name: string; value: string; domain: string }> };
        };
        if (msg.id === 1) {
          ws.close();
          resolve(msg.result?.cookies ?? []);
        }
      } catch (e) { reject(e); }
    });
    ws.on('error', (err: Error) => reject(err));
    setTimeout(() => reject(new Error('CDP getAllCookies timeout')), 5000);
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
