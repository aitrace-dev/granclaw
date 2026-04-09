/**
 * useAgentSocket
 *
 * Connects to a single agent's (or Big Brother's) WebSocket endpoint.
 * Each process runs its own WS server on its own port.
 *
 * Features:
 *   - Auto-reconnect on disconnect (exponential backoff, max 10s)
 *   - Fires onReconnect callback so UI can clear stale streaming state
 *   - Streaming timeout: if no chunks for 60s, fires error + done
 *
 * Usage:
 *   const { sendMessage, connected } = useAgentSocket(agent.wsPort, undefined, onReconnect);
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
  | { type: 'error'; message: string };

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
  wsPort: number | undefined,
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
    if (!wsPort) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (!mountedRef.current) return;

      const url = `ws://${window.location.hostname}:${wsPort}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        reconnectDelayRef.current = RECONNECT_MIN_MS; // reset backoff
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
        console.warn(`[ws] :${wsPort} disconnected — reconnecting in ${reconnectDelayRef.current}ms`);

        // Clear any stale streaming state
        clearStreamTimeout();
        if (handlerRef.current) {
          handlerRef.current = null;
        }
        onReconnectRef.current?.();

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
  }, [wsPort, resetStreamTimeout, clearStreamTimeout]);

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

  return { sendMessage, stopMessage, connected };
}
