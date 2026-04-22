/**
 * useAgentSocket
 *
 * Connects to an agent's WebSocket endpoint via the backend's WS proxy
 * at /ws/agents/:id. The browser only ever talks to the same origin that
 * served the page, so the whole app works through a single port.
 *
 * Features:
 *   - Auto-reconnect on disconnect (exponential backoff, max 10s)
 *   - Fires onReconnect callback so UI can clear stale streaming state
 *   - Streaming timeout: if no chunks for 90s, fires error + done
 *
 * Usage:
 *   const { sendMessage, connected } = useAgentSocket(agent.id, undefined, onReconnect);
 *   sendMessage("hello", (chunk) => { ... });
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'agent_ready'; name: string }
  | { type: 'blocked'; reason: string }
  | { type: 'pending_approval'; reason: string }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string }
  // Compaction heartbeat — fires around pi session.compact() so the UI
  // shows a visible indicator and the 90s stream timeout stays armed even
  // when compaction blocks the agent loop for tens of seconds.
  | { type: 'compaction_start'; reason: 'manual' | 'threshold' | 'overflow' }
  | { type: 'compaction_end'; reason: 'manual' | 'threshold' | 'overflow' }
  // Passive keep-alive emitted by runner-pi every ~30s during tool
  // execution. Not rendered — its only purpose is to reset the stream
  // idle timer so a long tool call isn't misclassified as a stalled turn.
  | { type: 'heartbeat' };

type WsMessage =
  | { type: 'chunk'; chunk: StreamChunk }
  | { type: 'blocked'; reason: string }
  | { type: 'pending_approval'; reason: string }
  | { type: 'queued' }
  | { type: 'error'; message: string };

type ChunkHandler = (chunk: StreamChunk) => void;

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;
const STREAM_TIMEOUT_MS = 90000; // 90s without chunks = stale

export function useAgentSocket(
  agentId: string | undefined,
  onServerMessage?: ChunkHandler,
  onReconnect?: () => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef<ChunkHandler | null>(null);
  const serverHandlerRef = useRef<ChunkHandler | undefined>(onServerMessage);
  serverHandlerRef.current = onServerMessage;
  const onReconnectRef = useRef<(() => void) | undefined>(onReconnect);
  onReconnectRef.current = onReconnect;
  const [connected, setConnected] = useState(false);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_MIN_MS);
  const mountedRef = useRef(true);
  const subscribeChannelRef = useRef<string | null>(null);

  // Reset stream timeout whenever we get a chunk
  const resetStreamTimeout = useCallback(() => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = setTimeout(() => {
      // No chunks for 90s — force done
      const handler = handlerRef.current;
      if (handler) {
        handler({ type: 'error', message: 'Stream timeout — no response for 90s' });
        handler({ type: 'done', sessionId: '' });
        handlerRef.current = null;
      }
    }, STREAM_TIMEOUT_MS);
  }, []);

  const clearStreamTimeout = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!agentId) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (!mountedRef.current) return;

      // Same-origin WS: the backend (or vite dev server) proxies /ws/agents/:id
      // to the internal agent process. This means the whole app works through
      // a single public port — no need to expose per-agent ports.
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${scheme}//${window.location.host}/ws/agents/${encodeURIComponent(agentId!)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        reconnectDelayRef.current = RECONNECT_MIN_MS; // reset backoff
        // Always (re)subscribe to the channel on open so chunks route
        // correctly after both fresh connections and reconnects. Default
        // to 'ui' — the chat channel the dashboard listens on. Without
        // this, the backend's channelClients set loses the client on
        // every disconnect and in-flight chunks are broadcast into the
        // void until the user sends a new message.
        const channel = subscribeChannelRef.current ?? 'ui';
        ws.send(JSON.stringify({ type: 'subscribe', channelId: channel }));
      };

      ws.onmessage = (event: MessageEvent) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(event.data as string) as WsMessage;
        } catch {
          return;
        }

        const handler = handlerRef.current ?? serverHandlerRef.current ?? null;
        if (msg.type === 'chunk') {
          resetStreamTimeout();
          handler?.(msg.chunk);
          // Clear timeout on done/error
          if (msg.chunk.type === 'done' || msg.chunk.type === 'error') {
            clearStreamTimeout();
          }
        } else if (msg.type === 'blocked') {
          handler?.({ type: 'blocked', reason: msg.reason });
        } else if (msg.type === 'pending_approval') {
          handler?.({ type: 'pending_approval', reason: msg.reason });
        } else if (msg.type === 'error') {
          handler?.({ type: 'error', message: msg.message });
          clearStreamTimeout();
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        console.warn(`[ws] ${agentId} disconnected — reconnecting in ${reconnectDelayRef.current}ms`);

        // DO NOT null handlerRef or fire onReconnect here. The backend
        // turn may still be running; if the WS reconnects quickly the
        // chunks resume flowing into the same handler and the UI picks
        // up where it left off. Previously we cleared `isSending` and
        // flagged streaming messages as "(connection lost)" on every
        // brief hiccup, which let the user start a second concurrent
        // turn while the first was still running — regression A.
        //
        // Catastrophic long-disconnect cleanup is handled by the 90s
        // stream timeout in resetStreamTimeout(), which fires if no
        // chunks arrive for 90s and gracefully marks the turn done.

        // Auto-reconnect with exponential backoff
        reconnectTimer = setTimeout(() => {
          reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, RECONNECT_MAX_MS);
          connect();
        }, reconnectDelayRef.current);
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearStreamTimeout();
      wsRef.current?.close();
      setConnected(false);
    };
  }, [agentId, resetStreamTimeout, clearStreamTimeout]);

  const sendMessage = useCallback((text: string, onChunk: ChunkHandler) => {
    handlerRef.current = onChunk;
    resetStreamTimeout();

    const send = () =>
      wsRef.current?.send(JSON.stringify({ type: 'message', text }));

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send();
    } else {
      wsRef.current?.addEventListener('open', send, { once: true });
    }
  }, [resetStreamTimeout]);

  const stopMessage = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    clearStreamTimeout();
    // Clear the handler so done/error from the killed process doesn't confuse the UI
    handlerRef.current = null;
  }, [clearStreamTimeout]);

  const subscribeToChannel = useCallback((channelId: string) => {
    subscribeChannelRef.current = channelId;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', channelId }));
    }
  }, []);

  return { sendMessage, stopMessage, subscribeToChannel, connected };
}
