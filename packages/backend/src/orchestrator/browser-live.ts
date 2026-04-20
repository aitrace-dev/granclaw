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
import { STEALTH_EXTENSION_DIR } from '../browser/stealth.js';
import fs from 'fs';
import path from 'path';

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

export interface CdpPage {
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
  /** CDP flat session ID for browser-level connections (cloud browsers). */
  flatSessionId: string | null;
  /**
   * Most recently created page target on this browser, as learned from
   * Target.targetCreated events. Preferred by pickCdpPageForTab when set —
   * disambiguates the "multiple tabs at the same URL" case (e.g. a stale
   * login-wall tab and the agent's fresh logged-in tab both sitting at
   * reddit.com). Null until the tracker observes its first page target.
   */
  preferredTargetId: string | null;
  targetTrackerWs: WebSocket | null;
}

const streams = new Map<string, Stream>();
const wss = new WebSocketServer({ noServer: true });

const externalCdpSessions = new Map<string, string>();

export function registerExternalCdpSession(agentId: string, sessionId: string, cdpUrl: string): void {
  externalCdpSessions.set(streamKey(agentId, sessionId), cdpUrl);
}

export function removeExternalCdpSession(agentId: string, sessionId: string): void {
  const key = streamKey(agentId, sessionId);
  externalCdpSessions.delete(key);
  const stream = streams.get(key);
  if (stream) disposeStream(key, stream);
}

function streamKey(agentId: string, sessionId: string): string {
  return `${agentId}::${sessionId}`;
}

export type UnavailableReason =
  | 'cdp_url_missing'
  | 'no_page_targets'
  | 'no_suitable_target'
  | 'agent_browser_not_running';

/**
 * Build the typed fallback frame the relay sends when it cannot attach. The
 * frontend uses `{ type: 'unavailable', reason }` to render a useful message
 * ("browser isn't running yet", "no open tab") instead of sitting silent.
 *
 * Previously the relay sent a free-form `{ type: 'error', reason: 'some string' }`
 * and the frontend had nothing structured to match on — bluggie's empty
 * livestream was the observable symptom of that silence.
 */
export function buildUnavailableFrame(opts: { reason: UnavailableReason; detail?: string }): {
  type: 'unavailable';
  reason: UnavailableReason;
  detail?: string;
} {
  const frame: { type: 'unavailable'; reason: UnavailableReason; detail?: string } = {
    type: 'unavailable',
    reason: opts.reason,
  };
  if (opts.detail) frame.detail = opts.detail;
  return frame;
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
  flatSessionId?: string | null,
): void {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(rawData); } catch { return; }

  const toNum = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const cdpSend = (method: string, params: Record<string, unknown>) => {
    const cmd: Record<string, unknown> = { id: nextId(), method, params };
    if (flatSessionId) cmd.sessionId = flatSessionId;
    chromeWs.send(JSON.stringify(cmd));
  };

  if (msg.type === 'mouse') {
    cdpSend('Input.dispatchMouseEvent', {
      type: String(msg.eventType ?? 'mouseMoved'),
      x: toNum(msg.x, 0),
      y: toNum(msg.y, 0),
      button: String(msg.button ?? 'none'),
      clickCount: toNum(msg.clickCount, 0),
      modifiers: toNum(msg.modifiers, 0),
    });
  } else if (msg.type === 'key') {
    const key = String(msg.key ?? '');
    if (!key) return;
    const eventType = String(msg.eventType ?? 'rawKeyDown');
    const params: Record<string, unknown> = {
      type: eventType,
      key,
      code: String(msg.code ?? ''),
      modifiers: toNum(msg.modifiers, 0),
    };
    if (msg.windowsVirtualKeyCode !== undefined) {
      params.windowsVirtualKeyCode = toNum(msg.windowsVirtualKeyCode, 0);
      params.nativeVirtualKeyCode = toNum(msg.windowsVirtualKeyCode, 0);
    }
    if (key === 'Enter' && eventType === 'rawKeyDown') {
      params.text = '\r';
    }
    cdpSend('Input.dispatchKeyEvent', params);
  } else if (msg.type === 'insertText') {
    const text = String(msg.text ?? '').slice(0, 4096);
    if (!text) return;
    cdpSend('Input.insertText', { text });
  } else if (msg.type === 'scroll') {
    cdpSend('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: toNum(msg.x, 0),
      y: toNum(msg.y, 0),
      deltaX: 0,
      deltaY: toNum(msg.deltaY, 0),
    });
  } else if (msg.type === 'navigate') {
    const url = String(msg.url ?? '');
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      cdpSend('Page.navigate', { url });
    }
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
function isInertUrl(url: string | undefined | null): boolean {
  return (
    !url ||
    url === 'about:blank' ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('chrome-untrusted://') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:')
  );
}

export function pickCdpPageForTab(
  pages: CdpPage[],
  activeUrl: string,
  preferredTargetId?: string | null,
): CdpPage | null {
  if (pages.length === 0) return null;

  // Prefer the tracker's recorded targetId — but only if it still points at
  // a real page. If the tracker landed on an internal target (chrome://newtab,
  // an extension page, about:blank), fall through to URL match so the
  // screencast doesn't bind to a target that never paints (bluggie
  // "waiting for stream" regression).
  if (preferredTargetId) {
    const hit = pages.find((p) => p.id === preferredTargetId);
    if (hit && !isInertUrl(hit.url)) return hit;
  }

  const exact = pages.filter((p) => p.url === activeUrl);
  if (exact.length > 0) return exact[exact.length - 1];

  const real = pages.filter((p) => !isInertUrl(p.url));
  return real.length > 0 ? real[real.length - 1] : pages[pages.length - 1];
}

/**
 * Open a sidecar CDP connection to the browser-level endpoint and subscribe
 * to `Target.targetCreated` so we can learn the truly newest page target
 * (what the agent just opened). Without this, pickCdpPageForTab has to fall
 * back to URL match — which ambiguates when two tabs share a URL (the
 * classic bluggie "stale login wall + fresh logged-in tab" case).
 *
 * Best-effort: if the tracker can't connect, the picker still works via its
 * URL heuristic, just with the duplicate-URL ambiguity.
 */
function startTargetTracker(stream: Stream): void {
  if (!stream.browserCdpUrl || stream.targetTrackerWs) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(stream.browserCdpUrl);
  } catch {
    return;
  }
  stream.targetTrackerWs = ws;
  ws.on('open', () => {
    try {
      ws.send(JSON.stringify({ id: 1, method: 'Target.setDiscoverTargets', params: { discover: true } }));
    } catch { /* peer already gone */ }
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        method?: string;
        params?: { targetInfo?: { targetId?: string; type?: string; url?: string } };
      };
      // Only latch onto real page targets (http/https). Orbita and GoLogin
      // expose chrome://newtab, chrome-extension://… pages too; those report
      // type:'page' but don't emit useful screencast frames, so picking them
      // leaves the takeover view frozen on "waiting for stream".
      const info = msg.params?.targetInfo;
      if (
        msg.method === 'Target.targetCreated' &&
        info?.type === 'page' &&
        info.targetId &&
        !isInertUrl(info.url)
      ) {
        stream.preferredTargetId = info.targetId;
      }
    } catch { /* malformed frame, ignore */ }
  });
  const clear = (): void => { if (stream.targetTrackerWs === ws) stream.targetTrackerWs = null; };
  ws.on('close', clear);
  ws.on('error', clear);
}

function stopTargetTracker(stream: Stream): void {
  if (stream.targetTrackerWs) {
    try { stream.targetTrackerWs.close(); } catch { /* already gone */ }
    stream.targetTrackerWs = null;
  }
}

/**
 * Lazily read stealth.js once and cache it. Returns null if the extension
 * directory is missing (e.g. the package wasn't installed with assets).
 */
let cachedStealthScript: string | null | undefined;
function readStealthScript(): string | null {
  if (cachedStealthScript !== undefined) return cachedStealthScript;
  if (!STEALTH_EXTENSION_DIR) { cachedStealthScript = null; return null; }
  const scriptPath = path.join(STEALTH_EXTENSION_DIR, 'stealth.js');
  try {
    cachedStealthScript = fs.readFileSync(scriptPath, 'utf-8');
  } catch {
    cachedStealthScript = null;
  }
  return cachedStealthScript;
}

/**
 * Inject the stealth patches on an already-open CDP WebSocket. Uses the
 * stream's cdpMessageId counter so IDs stay monotonically increasing.
 *
 * Two commands:
 *   - Page.addScriptToEvaluateOnNewDocument — persists across navigations
 *   - Runtime.evaluate                       — applies to the current document immediately
 *
 * Best-effort: silently skipped when stealth is disabled or the script is unavailable.
 */
function injectStealthOnPage(chromeWs: WebSocket, stream: Stream): void {
  if (process.env.GRANCLAW_STEALTH_DISABLED === '1') return;
  const script = readStealthScript();
  if (!script) return;

  try {
    chromeWs.send(JSON.stringify({
      id: ++stream.cdpMessageId,
      method: 'Page.addScriptToEvaluateOnNewDocument',
      params: { source: script },
    }));
    chromeWs.send(JSON.stringify({
      id: ++stream.cdpMessageId,
      method: 'Runtime.evaluate',
      params: { expression: script, returnByValue: false },
    }));
  } catch { /* ws closed between open and send — ignore */ }
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

    // Inject stealth patches on every page attach — works headlessly via CDP,
    // no display or extension loader needed.
    injectStealthOnPage(chromeWs, stream);

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

  const target = pickCdpPageForTab(pages, active.url, stream.preferredTargetId);
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
 * Attach to a browser-level CDP WebSocket (e.g. GoLogin cloud connect URL).
 * Uses Target.getTargets + Target.attachToTarget with flatten:true to reach
 * a page, then starts the screencast through the flattened session.
 */
function attachBrowserLevelCdp(stream: Stream, wsUrl: string): void {
  const chromeWs = new WebSocket(wsUrl);
  stream.chromeWs = chromeWs;
  stream.currentTargetId = 'browser-level';
  stream.screencastSessionId = null;
  stream.flatSessionId = null;

  chromeWs.on('open', () => {
    if (stream.disposed) { try { chromeWs.close(); } catch {} return; }

    chromeWs.send(JSON.stringify({
      id: ++stream.cdpMessageId,
      method: 'Target.getTargets',
    }));
  });

  chromeWs.on('message', (buf) => {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; sessionId?: string };
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // Response to Target.getTargets — find first page and attach
    if (msg.result && (msg.result as any).targetInfos) {
      const targets = (msg.result as any).targetInfos as Array<{
        targetId: string; type: string; url: string; title: string;
      }>;
      const page = targets.find(t => t.type === 'page');
      if (page) {
        chromeWs.send(JSON.stringify({
          id: ++stream.cdpMessageId,
          method: 'Target.attachToTarget',
          params: { targetId: page.targetId, flatten: true },
        }));
        sendToSubscribers(stream, {
          type: 'attached',
          targetId: page.targetId,
          url: page.url,
          title: page.title,
        });
      } else {
        sendToSubscribers(stream, { type: 'error', reason: 'no page targets in cloud browser' });
      }
      return;
    }

    // Response to Target.attachToTarget — set viewport, then start screencast
    if (msg.result && typeof (msg.result as any).sessionId === 'string') {
      stream.flatSessionId = (msg.result as any).sessionId;
      chromeWs.send(JSON.stringify({
        id: ++stream.cdpMessageId,
        method: 'Emulation.setDeviceMetricsOverride',
        params: {
          width: LIVE_VIEW_WIDTH,
          height: LIVE_VIEW_HEIGHT,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId: stream.flatSessionId,
      }));
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
        sessionId: stream.flatSessionId,
      }));
      return;
    }

    // Screencast frames from the flattened session
    if (msg.method === 'Page.screencastFrame' && msg.params) {
      const data = msg.params.data as string;
      const scSessionId = msg.params.sessionId as number;
      stream.screencastSessionId = scSessionId;
      sendToSubscribers(stream, { type: 'frame', data, timestamp: Date.now() });
      try {
        const ack: Record<string, unknown> = {
          id: ++stream.cdpMessageId,
          method: 'Page.screencastFrameAck',
          params: { sessionId: scSessionId },
        };
        if (stream.flatSessionId) ack.sessionId = stream.flatSessionId;
        chromeWs.send(JSON.stringify(ack));
      } catch { /* chrome disconnected */ }
    }
  });

  chromeWs.on('close', () => {
    if (!stream.disposed && stream.chromeWs === chromeWs) {
      sendToSubscribers(stream, { type: 'detached', reason: 'cloud browser disconnected' });
    }
  });

  chromeWs.on('error', () => {
    if (!stream.disposed && stream.chromeWs === chromeWs) {
      sendToSubscribers(stream, { type: 'error', reason: 'cloud browser cdp error' });
    }
  });
}

/**
 * Initial attach: discover the daemon, raise the viewport, find the active
 * tab, bind screencast, start the poll loop.
 */
async function attachChrome(stream: Stream): Promise<UnavailableReason | null> {
  const key = streamKey(stream.agentId, stream.sessionId);
  const externalCdp = externalCdpSessions.get(key);

  if (externalCdp) {
    stream.browserCdpUrl = externalCdp;
  } else {
    const browserCdp = await discoverCdpUrl(stream.agentId, stream.workspaceDir);
    if (!browserCdp) return 'cdp_url_missing';
    stream.browserCdpUrl = browserCdp;
    await raiseViewport(stream.agentId, stream.workspaceDir);
  }

  startTargetTracker(stream);

  const active = externalCdp ? null : await getActiveTab(stream.agentId, stream.workspaceDir);
  const pages = await fetchCdpPages(stream.browserCdpUrl);

  if (pages.length === 0 && externalCdp) {
    // External CDP sessions (e.g. GoLogin cloud) don't expose /json/list.
    // Connect to the browser-level WS and use Target.attachToTarget to
    // reach a page. This handles cloud browser proxies that only provide
    // a single browser-level WebSocket endpoint.
    attachBrowserLevelCdp(stream, externalCdp);
    return null;
  }

  if (pages.length === 0) return 'no_page_targets';

  const target = pickCdpPageForTab(pages, active?.url ?? '', stream.preferredTargetId);
  if (!target) return 'no_suitable_target';

  attachPageCdp(stream, target);
  if (!externalCdp) startPollLoop(stream);
  return null;
}

function disposeStream(key: string, stream: Stream): void {
  stream.disposed = true;
  stopPollLoop(stream);
  stopTargetTracker(stream);
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
        flatSessionId: null,
        preferredTargetId: null,
        targetTrackerWs: null,
      };
      streams.set(key, stream);

      void attachChrome(stream).then((reason) => {
        if (reason) {
          sendToSubscribers(stream!, buildUnavailableFrame({ reason }));
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
      relayInputToChrome(s.chromeWs, () => ++s.cdpMessageId, data.toString(), s.flatSessionId);
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
