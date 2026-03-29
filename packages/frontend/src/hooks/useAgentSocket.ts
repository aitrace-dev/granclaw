/**
 * useAgentSocket
 *
 * Manages a single shared WebSocket connection to the backend.
 * Sends messages to agents and streams chunks back.
 */

import { useEffect, useRef, useCallback } from 'react';

const WS_URL = `ws://${window.location.hostname}:3001`;

type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: unknown }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; message: string };

type WsMessage =
  | { type: 'chunk'; agentId: string; chunk: StreamChunk }
  | { type: 'error'; agentId?: string; message: string };

type ChunkHandler = (chunk: StreamChunk) => void;

export function useAgentSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, ChunkHandler>>(new Map());

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (event: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data as string) as WsMessage;
      } catch {
        return;
      }

      if (msg.type === 'chunk') {
        handlersRef.current.get(msg.agentId)?.(msg.chunk);
      } else if (msg.type === 'error') {
        const agentId = msg.agentId ?? '__global';
        handlersRef.current.get(agentId)?.({ type: 'error', message: msg.message });
      }
    };

    ws.onclose = () => {
      console.warn('[ws] disconnected — will not reconnect automatically');
    };

    return () => ws.close();
  }, []);

  const sendMessage = useCallback(
    (agentId: string, text: string, onChunk: ChunkHandler) => {
      handlersRef.current.set(agentId, onChunk);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'message', agentId, text }));
      } else {
        wsRef.current?.addEventListener('open', () => {
          wsRef.current?.send(JSON.stringify({ type: 'message', agentId, text }));
        }, { once: true });
      }
    },
    []
  );

  return { sendMessage };
}
