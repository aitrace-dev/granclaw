/**
 * browser-live.ts
 *
 * Live screencast relay for active browser sessions.
 *
 * Lifecycle:
 *   1. Frontend opens ws://.../browser-live/:agentId/:sessionId
 *   2. On first subscriber for a (agentId, sessionId) pair, the backend:
 *        a. shells out to `agent-browser --session <id> get cdp-url` to find
 *           that agent's dedicated daemon
 *        b. polls `agent-browser --session <id> tab --json` for the currently
 *           active tab (the one with active:true)
 *        c. matches that tab's URL against http://<host>:<port>/json/list
 *           to find the matching CDP page target
 *        d. opens a CDP WebSocket to that page target and sends
 *           Page.startScreencast
 *   3. Every screencastFrame is fanned out as a JSON frame message to all
 *      subscribers
 *   4. A 2-second poll loop re-runs step 2 + 3. If the agent switches tabs
 *      (via `tab N` or `tab new`), the relay detaches from the old target,
 *      attaches to the new one, and emits a `tab_changed` event so the
 *      frontend can show a "Watching: <title>" label
 *   5. On last subscriber disconnect (ref-count → 0), the poll is cancelled
 *      and the Chrome CDP socket is closed
 *
 * The relay is best-effort. If agent-browser isn't running or CDP is
 * unreachable, subscribers see an error event and the live view shows a
 * placeholder.
 */

import http from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const TAB_POLL_INTERVAL_MS = 2000;

/**
 * Viewport we override the page to before starting the screencast.
 *
 * agent-browser's default viewport is 1280×577 — oddly short, it crops most
 * web pages awkwardly. We set 1280×800 via Emulation.setDeviceMetricsOverride
 * on each attach so the live view sees a realistic desktop-laptop viewport,
 * without changing the default device scale factor (DPR stays 1 so agent
 * eval/snapshot behavior is unchanged).
 */
const LIVE_VIEW_WIDTH = 1280;
const LIVE_VIEW_HEIGHT = 800;

interface CdpPage {
  id: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

interface ActiveTab {
  index: number;
  url: string;
  title: string;
}

interface Stream {
  agentId: string;
  sessionId: string;
  workspaceDir: string;
  browserCdpUrl: string | null;
  chromeWs: WebSocket | null;
  currentTargetId: string | null;
  subscribers: Set<WebSocket>;
  cdpMessageId: number;
  screencastSessionId: number | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  disposed: boolean;
}

const streams = new Map<string, Stream>();
const wss = new WebSocketServer({ noServer: true });

function streamKey(agentId: string, sessionId: string): string {
  return `${agentId}::${sessionId}`;
}

/**
 * Minimal interface for the WebSocket we send CDP commands to. Lets tests
 * pass a fake `send` function without depending on the real `ws` module.
 */
interface CdpSender {
  send(data: string): void;
}

/**
 * Translate an input event from the takeover page into a CDP command and
 * forward it to Chrome. Extracted so it can be unit tested with a mock
 * chromeWs.
 *
 * Input fields are validated: numeric coordinates are safely cast with a
 * fallback, string fields default to safe values, `insertText` is capped at
 * 4 KB, and `dispatchKeyEvent` requires a `key` field.
 */
export function relayInputToChrome(
  chromeWs: CdpSender,
  nextId: () => number,
  rawData: string,
): void {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(rawData); } catch { return; }

  const toNum = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  if (msg.type === 'mouse') {
    const eventType = String(msg.eventType ?? 'mouseMoved');
    const button = String(msg.button ?? 'none');
    chromeWs.send(JSON.stringify({
      id: nextId(),
      method: 'Input.dispatchMouseEvent',
      params: {
        type: eventType,
        x: toNum(msg.x, 0),
        y: toNum(msg.y, 0),
        button,
        clickCount: toNum(msg.clickCount, 0),
        modifiers: toNum(msg.modifiers, 0),
      },
    }));
  } else if (msg.type === 'key') {
    const eventType = String(msg.eventType ?? 'rawKeyDown');
    const key = String(msg.key ?? '');
    const code = String(msg.code ?? '');
    if (!key) return; // key is required
    chromeWs.send(JSON.stringify({
      id: nextId(),
      method: 'Input.dispatchKeyEvent',
      params: {
        type: eventType,
        key,
        code,
        modifiers: toNum(msg.modifiers, 0),
      },
    }));
  } else if (msg.type === 'insertText') {
    const text = String(msg.text ?? '').slice(0, 4096); // cap at 4 KB
    if (!text) return;
    chromeWs.send(JSON.stringify({
      id: nextId(),
      method: 'Input.insertText',
      params: { text },
    }));
  } else if (msg.type === 'scroll') {
    chromeWs.send(JSON.stringify({
      id: nextId(),
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel',
        x: toNum(msg.x, 0),
        y: toNum(msg.y, 0),
        deltaX: 0,
        deltaY: toNum(msg.deltaY, 0),
      },
    }));
  }
}

function sendToSubscribers(stream: Stream, payload: object): void {
  const msg = JSON.stringify(payload);
  for (const sub of stream.subscribers) {
    if (sub.readyState === WebSocket.OPEN) {
      try { sub.send(msg); } catch { /* subscriber dead, will be cleaned up */ }
    }
  }
}

/**
 * Discover the browser-level CDP URL for this agent's dedicated daemon.
 * Returns null if that daemon isn't running.
 */
async function discoverCdpUrl(agentId: string, workspaceDir: string): Promise<string | null> {
  try {
    const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
    const { stdout } = await execFileAsync(bin, ['--session', agentId, 'get', 'cdp-url'], {
      cwd: workspaceDir,
      timeout: 5000,
    });
    const url = stdout.trim();
    return url.startsWith('ws://') || url.startsWith('wss://') ? url : null;
  } catch {
    return null;
  }
}

/**
 * Ask agent-browser which tab is currently active. Uses --json so there's no
 * ANSI-escape parsing. Returns null if agent-browser isn't running or the
 * response can't be parsed.
 */
async function getActiveTab(agentId: string, workspaceDir: string): Promise<ActiveTab | null> {
  try {
    const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
    const { stdout } = await execFileAsync(bin, ['--session', agentId, 'tab', '--json'], {
      cwd: workspaceDir,
      timeout: 3000,
    });
    const parsed = JSON.parse(stdout) as {
      success?: boolean;
      data?: { tabs?: Array<{ active?: boolean; index: number; url: string; title: string }> };
    };
    const tabs = parsed.data?.tabs ?? [];
    const active = tabs.find((t) => t.active === true);
    if (!active) return null;
    return { index: active.index, url: active.url, title: active.title };
  } catch {
    return null;
  }
}

/**
 * Fetch the CDP page list from the browser. Returns only targets with type
 * 'page' that have a webSocketDebuggerUrl.
 */
async function fetchCdpPages(browserCdpUrl: string): Promise<CdpPage[]> {
  const match = /^wss?:\/\/([^/]+)\//.exec(browserCdpUrl);
  if (!match) return [];
  const host = match[1];

  return new Promise((resolve) => {
    const req = http.get(`http://${host}/json/list`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        try {
          const targets = JSON.parse(body) as Array<{
            id: string;
            type: string;
            url?: string;
            title?: string;
            webSocketDebuggerUrl?: string;
          }>;
          const pages: CdpPage[] = targets
            .filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
            .map((t) => ({
              id: t.id,
              url: t.url ?? '',
              title: t.title ?? '',
              webSocketDebuggerUrl: t.webSocketDebuggerUrl as string,
            }));
          resolve(pages);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Find the CDP page target that matches agent-browser's active tab URL.
 *
 * Selection rules:
 *   1. Exact URL match — best case, unique mapping
 *   2. If multiple exact matches (duplicate URLs across tabs), pick the
 *      first one. Agent-browser's tab index and Chrome's /json/list ordering
 *      are not guaranteed to correlate, so we can't perfectly disambiguate
 *      duplicates without a stable cross-reference. In practice duplicate
 *      URLs across tabs are rare; the "frontend tab picker" follow-up can
 *      fix the edge case later.
 *   3. No exact match — fall back to the newest non-inert page (skipping
 *      about:blank, chrome://, devtools://, view-source:). This covers the
 *      window between a `tab new <url>` and agent-browser finishing its
 *      navigation, when the tab temporarily has a different URL.
 */
function pickCdpPageForTab(pages: CdpPage[], activeUrl: string): CdpPage | null {
  if (pages.length === 0) return null;

  const exact = pages.filter((p) => p.url === activeUrl);
  if (exact.length > 0) return exact[0];

  const isInert = (url: string): boolean =>
    !url ||
    url === 'about:blank' ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-untrusted://') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:');

  const real = pages.filter((p) => !isInert(p.url));
  return real.length > 0 ? real[real.length - 1] : pages[pages.length - 1];
}

/**
 * Attach to a specific CDP page target and begin screencasting. Called on
 * initial attach and again whenever we need to rebind to a new tab.
 */
function attachPageCdp(stream: Stream, page: CdpPage): void {
  const chromeWs = new WebSocket(page.webSocketDebuggerUrl);
  stream.chromeWs = chromeWs;
  stream.currentTargetId = page.id;
  stream.screencastSessionId = null;

  chromeWs.on('open', () => {
    if (stream.disposed) { try { chromeWs.close(); } catch {} return; }

    chromeWs.send(JSON.stringify({
      id: ++stream.cdpMessageId,
      method: 'Page.startScreencast',
      params: {
        format: 'jpeg',
        quality: 60,
        maxWidth: LIVE_VIEW_WIDTH,
        maxHeight: LIVE_VIEW_HEIGHT,
        everyNthFrame: 1,
      },
    }));

    sendToSubscribers(stream, {
      type: 'attached',
      targetId: page.id,
      url: page.url,
      title: page.title,
    });
  });

  chromeWs.on('message', (buf) => {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; error?: unknown };
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.method === 'Page.screencastFrame' && msg.params) {
      const data = msg.params.data as string;
      const sessionId = msg.params.sessionId as number;
      stream.screencastSessionId = sessionId;
      sendToSubscribers(stream, { type: 'frame', data, timestamp: Date.now() });
      const ackId = ++stream.cdpMessageId;
      try {
        chromeWs.send(JSON.stringify({
          id: ackId,
          method: 'Page.screencastFrameAck',
          params: { sessionId },
        }));
      } catch { /* chrome disconnected */ }
    }
  });

  chromeWs.on('close', () => {
    if (!stream.disposed && stream.chromeWs === chromeWs) {
      sendToSubscribers(stream, { type: 'detached', reason: 'chrome disconnected' });
    }
  });

  chromeWs.on('error', () => {
    if (!stream.disposed && stream.chromeWs === chromeWs) {
      sendToSubscribers(stream, { type: 'error', reason: 'chrome cdp error' });
    }
  });
}

/**
 * Gracefully detach from the current page target — stop the screencast,
 * close the WS. Safe to call on a stream with no current binding.
 */
function detachPageCdp(stream: Stream): void {
  const ws = stream.chromeWs;
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN && stream.screencastSessionId != null) {
      ws.send(JSON.stringify({
        id: ++stream.cdpMessageId,
        method: 'Page.stopScreencast',
      }));
    }
  } catch { /* already gone */ }
  try { ws.close(); } catch { /* already gone */ }
  stream.chromeWs = null;
  stream.currentTargetId = null;
  stream.screencastSessionId = null;
}

/**
 * Ask agent-browser which tab is active, find the matching CDP target, and
 * rebind the screencast if it differs from the currently bound one. Runs
 * every TAB_POLL_INTERVAL_MS while the stream has subscribers.
 */
async function pollActiveTab(stream: Stream): Promise<void> {
  if (stream.disposed || !stream.browserCdpUrl) return;

  const active = await getActiveTab(stream.agentId, stream.workspaceDir);
  if (!active) return;

  const pages = await fetchCdpPages(stream.browserCdpUrl);
  if (pages.length === 0) return;

  const target = pickCdpPageForTab(pages, active.url);
  if (!target) return;

  if (target.id === stream.currentTargetId) return;

  // Tab switch detected — detach and rebind
  detachPageCdp(stream);
  if (stream.disposed) return;
  sendToSubscribers(stream, {
    type: 'tab_changed',
    index: active.index,
    url: active.url,
    title: active.title,
  });
  attachPageCdp(stream, target);
}

function startPollLoop(stream: Stream): void {
  if (stream.pollTimer) return;
  stream.pollTimer = setInterval(() => {
    void pollActiveTab(stream);
  }, TAB_POLL_INTERVAL_MS);
}

function stopPollLoop(stream: Stream): void {
  if (stream.pollTimer) {
    clearInterval(stream.pollTimer);
    stream.pollTimer = null;
  }
}

/**
 * Raise the daemon's viewport to a sensible desktop default.
 *
 * agent-browser's default viewport is 1280×577 which crops most pages
 * awkwardly. We'd rather send a plain CDP Emulation.setDeviceMetricsOverride
 * but that gets silently ignored — agent-browser manages its window bounds
 * internally and only honors its own `set viewport` CLI command. Shelling
 * out to that works reliably.
 *
 * Best-effort: we don't fail the attach if this errors.
 */
async function raiseViewport(agentId: string, workspaceDir: string): Promise<void> {
  try {
    const bin = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
    await execFileAsync(
      bin,
      ['--session', agentId, 'set', 'viewport', String(LIVE_VIEW_WIDTH), String(LIVE_VIEW_HEIGHT)],
      { cwd: workspaceDir, timeout: 3000 },
    );
  } catch {
    // Best effort — if agent-browser refuses, the frame just ends up smaller.
  }
}

/**
 * Initial attach: discover the daemon, raise the viewport, find the active
 * tab, bind screencast, start the poll loop.
 */
async function attachChrome(stream: Stream): Promise<string | null> {
  const browserCdp = await discoverCdpUrl(stream.agentId, stream.workspaceDir);
  if (!browserCdp) return 'agent-browser not running or CDP unavailable';
  stream.browserCdpUrl = browserCdp;

  await raiseViewport(stream.agentId, stream.workspaceDir);

  const active = await getActiveTab(stream.agentId, stream.workspaceDir);
  const pages = await fetchCdpPages(browserCdp);
  if (pages.length === 0) return 'no page targets available';

  const target = active
    ? pickCdpPageForTab(pages, active.url)
    : pickCdpPageForTab(pages, ''); // triggers the "newest non-inert" fallback
  if (!target) return 'no suitable page target';

  attachPageCdp(stream, target);
  startPollLoop(stream);
  return null;
}

function disposeStream(key: string, stream: Stream): void {
  stream.disposed = true;
  stopPollLoop(stream);
  detachPageCdp(stream);
  streams.delete(key);
}

/**
 * HTTP upgrade handler. Caller wires this to server.on('upgrade', …) for the
 * /browser-live/:agentId/:sessionId path.
 */
export function handleBrowserLiveUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  getWorkspaceDir: (agentId: string) => string | null,
): boolean {
  const url = req.url ?? '';
  const match = /^\/browser-live\/([^/]+)\/([^/?#]+)/.exec(url);
  if (!match) return false;

  const agentId = decodeURIComponent(match[1]);
  const sessionId = decodeURIComponent(match[2]);
  const workspaceDir = getWorkspaceDir(agentId);
  if (!workspaceDir) {
    socket.destroy();
    return true;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const key = streamKey(agentId, sessionId);
    let stream = streams.get(key);

    if (!stream) {
      stream = {
        agentId,
        sessionId,
        workspaceDir,
        browserCdpUrl: null,
        chromeWs: null,
        currentTargetId: null,
        subscribers: new Set([ws]),
        cdpMessageId: 0,
        screencastSessionId: null,
        pollTimer: null,
        disposed: false,
      };
      streams.set(key, stream);

      void attachChrome(stream).then((err) => {
        if (err) {
          sendToSubscribers(stream!, { type: 'error', reason: err });
        }
      });
    } else {
      stream.subscribers.add(ws);
      if (stream.chromeWs?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'attached', targetId: stream.currentTargetId }));
      }
    }

    // Relay input events from the takeover page to Chrome via CDP
    ws.on('message', (data) => {
      const s = streams.get(key);
      if (!s?.chromeWs || s.chromeWs.readyState !== WebSocket.OPEN) return;
      relayInputToChrome(s.chromeWs, () => ++s.cdpMessageId, data.toString());
    });

    ws.on('close', () => {
      const s = streams.get(key);
      if (!s) return;
      s.subscribers.delete(ws);
      if (s.subscribers.size === 0) {
        disposeStream(key, s);
      }
    });

    ws.on('error', () => {
      const s = streams.get(key);
      if (!s) return;
      s.subscribers.delete(ws);
      if (s.subscribers.size === 0) {
        disposeStream(key, s);
      }
    });
  });

  return true;
}

/**
 * Shut down every active live stream (called on backend termination).
 */
export function shutdownAllBrowserLiveStreams(): void {
  for (const [key, stream] of streams) {
    disposeStream(key, stream);
  }
}
