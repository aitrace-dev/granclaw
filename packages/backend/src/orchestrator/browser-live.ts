/**
 * browser-live.ts
 *
 * Live screencast relay for active browser sessions.
 *
 * Lifecycle:
 *   1. Frontend opens ws://.../browser-live/:agentId/:sessionId
 *   2. On first subscriber for a (agentId, sessionId) pair, the backend:
 *        a. shells out to `agent-browser get cdp-url` to discover Chrome's CDP port
 *        b. fetches http://<host>:<port>/json/list to find the active "page" target
 *        c. opens a CDP WebSocket to that page target
 *        d. sends Page.startScreencast (jpeg, q60, 800×600, every frame)
 *   3. Every screencastFrame is fanned out as a JSON message to all subscribers
 *   4. On last subscriber disconnect (ref-count → 0), the screencast is stopped
 *      and the Chrome CDP socket is closed
 *
 * The relay is best-effort. If Chrome isn't running or CDP isn't reachable,
 * the subscriber socket is closed with a descriptive reason so the frontend
 * can show a placeholder.
 *
 * Known limitation: this only follows the *first* page target discovered. If
 * the agent switches tabs, the live view will still show the original tab
 * until the agent closes it. Tab-following via Target.targetCreated is TODO.
 */

import http from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface Stream {
  agentId: string;
  sessionId: string;
  chromeWs: WebSocket | null;
  subscribers: Set<WebSocket>;
  cdpMessageId: number;
  screencastSessionId: number | null;
  disposed: boolean;
}

const streams = new Map<string, Stream>();
const wss = new WebSocketServer({ noServer: true });

function streamKey(agentId: string, sessionId: string): string {
  return `${agentId}::${sessionId}`;
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
 * Discover the CDP URL for this agent's dedicated agent-browser daemon.
 * The --session flag scopes the lookup so the CDP relay binds to that
 * agent's Chrome (not the default daemon or another agent's).
 * Returns null if that daemon isn't running or agent-browser fails.
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
 * From a browser-level CDP URL (ws://.../devtools/browser/<uuid>) extract the
 * host:port and query the /json/list endpoint to find the active page target.
 */
async function findPageTarget(browserCdpUrl: string): Promise<string | null> {
  const match = /^wss?:\/\/([^/]+)\//.exec(browserCdpUrl);
  if (!match) return null;
  const host = match[1];

  return new Promise((resolve) => {
    const req = http.get(`http://${host}/json/list`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        try {
          const targets = JSON.parse(body) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
          const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
          resolve(page?.webSocketDebuggerUrl ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function attachChrome(stream: Stream, workspaceDir: string): Promise<string | null> {
  const browserCdp = await discoverCdpUrl(stream.agentId, workspaceDir);
  if (!browserCdp) return 'agent-browser not running or CDP unavailable';

  const pageCdp = await findPageTarget(browserCdp);
  if (!pageCdp) return 'no page target available';

  const chromeWs = new WebSocket(pageCdp);
  stream.chromeWs = chromeWs;

  chromeWs.on('open', () => {
    if (stream.disposed) { chromeWs.close(); return; }
    const id = ++stream.cdpMessageId;
    chromeWs.send(JSON.stringify({
      id,
      method: 'Page.startScreencast',
      params: { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 },
    }));
    sendToSubscribers(stream, { type: 'attached' });
  });

  chromeWs.on('message', (buf) => {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; error?: unknown };
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.method === 'Page.screencastFrame' && msg.params) {
      const data = msg.params.data as string;
      const sessionId = msg.params.sessionId as number;
      stream.screencastSessionId = sessionId;
      sendToSubscribers(stream, { type: 'frame', data, timestamp: Date.now() });
      // Ack the frame so Chrome keeps sending more
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
    if (!stream.disposed) {
      sendToSubscribers(stream, { type: 'detached', reason: 'chrome disconnected' });
    }
  });

  chromeWs.on('error', () => {
    if (!stream.disposed) {
      sendToSubscribers(stream, { type: 'error', reason: 'chrome cdp error' });
    }
  });

  return null;
}

function disposeStream(key: string, stream: Stream): void {
  stream.disposed = true;
  if (stream.chromeWs && stream.chromeWs.readyState === WebSocket.OPEN) {
    try {
      if (stream.screencastSessionId != null) {
        stream.chromeWs.send(JSON.stringify({
          id: ++stream.cdpMessageId,
          method: 'Page.stopScreencast',
        }));
      }
      stream.chromeWs.close();
    } catch { /* already gone */ }
  }
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
        chromeWs: null,
        subscribers: new Set([ws]),
        cdpMessageId: 0,
        screencastSessionId: null,
        disposed: false,
      };
      streams.set(key, stream);

      void attachChrome(stream, workspaceDir).then((err) => {
        if (err) {
          sendToSubscribers(stream!, { type: 'error', reason: err });
        }
      });
    } else {
      stream.subscribers.add(ws);
      if (stream.chromeWs?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'attached' }));
      }
    }

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
