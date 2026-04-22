/**
 * useAgentSocket.test.tsx
 *
 * Covers the Hernan/Bluggie regression: compaction blocks the agent turn
 * for tens of seconds on bloated contexts. Without compaction chunks
 * reaching the WS client, the 90s STREAM_TIMEOUT fires and the user sees
 * the generic "⚠ The agent took too long to respond" error.
 *
 * We assert two things the hook must deliver for the fix to hold:
 *   1. A compaction_start chunk resets the 90s stream timer (so the
 *      timeout does NOT fire at 90s if compaction is still in flight).
 *   2. A compaction_end chunk also resets the timer (so the turn can
 *      continue without the timeout firing mid-compaction).
 *
 * We do not simulate the whole pi session here — we just feed the hook
 * chunks through a fake WebSocket and watch handler behaviour.
 */

import { renderHook, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { useAgentSocket, type StreamChunk } from './useAgentSocket.ts';

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    // Open on next microtask — matches browser semantics.
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  addEventListener(_ev: string, cb: () => void, _opts?: unknown) {
    // Fired for 'open'; call immediately if already open.
    if (this.readyState === FakeWebSocket.OPEN) cb();
  }

  send(data: string) { this.sent.push(data); }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  // Test hook: push a server-side chunk onto the socket as a WsMessage.
  pushChunk(chunk: StreamChunk) {
    const msg = { type: 'chunk', chunk };
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent);
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeWebSocket;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).WebSocket;
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useAgentSocket — 90s stream timeout behaviour', () => {
  it('fires a timeout error when no chunks arrive for 90s after sendMessage', async () => {
    const { result } = renderHook(() => useAgentSocket('agent-1'));
    await act(async () => { await flushMicrotasks(); });
    expect(FakeWebSocket.instances).toHaveLength(1);

    const received: StreamChunk[] = [];
    act(() => {
      result.current.sendMessage('hi', (c) => received.push(c));
    });

    // 89s: no timeout yet.
    act(() => { vi.advanceTimersByTime(89_000); });
    expect(received).toEqual([]);

    // Cross 90s: timeout error + done are injected.
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(received[0]).toEqual({ type: 'error', message: expect.stringContaining('Stream timeout') });
    expect(received[1]).toMatchObject({ type: 'done' });
  });

  it('compaction_start chunk resets the 90s timer (no timeout during compaction)', async () => {
    const { result } = renderHook(() => useAgentSocket('agent-1'));
    await act(async () => { await flushMicrotasks(); });
    const ws = FakeWebSocket.instances[0];

    const received: StreamChunk[] = [];
    act(() => {
      result.current.sendMessage('hi', (c) => received.push(c));
    });

    // 80s into the turn, compaction starts — this is the exact shape of
    // the Hernan bug: the turn is silent, compaction blocks, the 90s
    // client-side timeout is about to fire.
    act(() => { vi.advanceTimersByTime(80_000); });
    act(() => { ws.pushChunk({ type: 'compaction_start', reason: 'manual' }); });
    expect(received).toEqual([{ type: 'compaction_start', reason: 'manual' }]);

    // 85s later (total 165s wall clock), with no other chunks: still no
    // timeout, because compaction_start reset the timer at 80s.
    act(() => { vi.advanceTimersByTime(85_000); });
    expect(received.find((c) => c.type === 'error')).toBeUndefined();

    // Finally, 10s more (5s past the new 90s budget) — now we'd expect
    // a timeout to fire. Verifies the timer is genuinely armed, not
    // disabled.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(received.find((c) => c.type === 'error')).toBeDefined();
  });

  it('compaction_end chunk also resets the 90s timer', async () => {
    const { result } = renderHook(() => useAgentSocket('agent-1'));
    await act(async () => { await flushMicrotasks(); });
    const ws = FakeWebSocket.instances[0];

    const received: StreamChunk[] = [];
    act(() => {
      result.current.sendMessage('hi', (c) => received.push(c));
    });

    // compaction_start at 30s, compaction_end at 89s — the end chunk
    // alone must carry the timer forward so the agent has budget to
    // resume the real response.
    act(() => { vi.advanceTimersByTime(30_000); });
    act(() => { ws.pushChunk({ type: 'compaction_start', reason: 'manual' }); });
    act(() => { vi.advanceTimersByTime(59_000); });
    act(() => { ws.pushChunk({ type: 'compaction_end', reason: 'manual' }); });

    // +80s after compaction_end — still under 90s, no timeout.
    act(() => { vi.advanceTimersByTime(80_000); });
    expect(received.find((c) => c.type === 'error')).toBeUndefined();
  });

  it('routes chunks to onServerMessage when no sendMessage handler is active (multi-tab case)', async () => {
    // This is the foreign-tab sync path: Tab A did not call sendMessage,
    // but Tab B did. Tab A's WS still receives the broadcast chunks and
    // must deliver them to its server-message handler so the UI can
    // refetch messages on the turn-ending chunk.
    const serverChunks: StreamChunk[] = [];
    renderHook(() => useAgentSocket('agent-1', (c) => serverChunks.push(c)));
    await act(async () => { await flushMicrotasks(); });
    const ws = FakeWebSocket.instances[0];

    act(() => { ws.pushChunk({ type: 'text', text: 'foreign stream' }); });
    act(() => { ws.pushChunk({ type: 'done', sessionId: 'xyz' }); });

    expect(serverChunks).toEqual([
      { type: 'text', text: 'foreign stream' },
      { type: 'done', sessionId: 'xyz' },
    ]);
  });
});
