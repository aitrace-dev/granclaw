/**
 * channel-broadcast.test.ts
 *
 * Covers the multi-tab sync contract: when two browser tabs are open on
 * the same agent/channel, both must receive every broadcast chunk. The
 * regression we're guarding against: Tab A subscribes, Tab B subscribes
 * after, agent emits a chunk → only one of them receives it because the
 * channel set was overwritten instead of added to.
 */

import { describe, it, expect } from 'vitest';
import { broadcastToClients, getOrCreateChannelSet, WS_OPEN } from './channel-broadcast.js';

function fakeWs(readyState = WS_OPEN) {
  const sent: string[] = [];
  return {
    readyState,
    send(data: string) { sent.push(data); },
    sent,
  };
}

describe('broadcastToClients', () => {
  it('sends to every OPEN client in the set', () => {
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    const n = broadcastToClients([a, b, c], { type: 'chunk', chunk: { type: 'text', text: 'hi' } });
    expect(n).toBe(3);
    const expected = JSON.stringify({ type: 'chunk', chunk: { type: 'text', text: 'hi' } });
    expect(a.sent).toEqual([expected]);
    expect(b.sent).toEqual([expected]);
    expect(c.sent).toEqual([expected]);
  });

  it('skips CLOSING/CLOSED clients without throwing', () => {
    const live = fakeWs(WS_OPEN);
    const closing = fakeWs(2); // CLOSING
    const closed = fakeWs(3);  // CLOSED
    const n = broadcastToClients([live, closing, closed], { foo: 1 });
    expect(n).toBe(1);
    expect(live.sent).toHaveLength(1);
    expect(closing.sent).toHaveLength(0);
    expect(closed.sent).toHaveLength(0);
  });

  it('handles an empty iterable as a no-op', () => {
    expect(broadcastToClients([], { foo: 'bar' })).toBe(0);
  });

  it('serializes the payload exactly once (proxy test)', () => {
    // We can't observe JSON.stringify calls directly, but we can observe
    // that every client receives the same string instance semantics by
    // checking equality of the delivered payloads.
    const a = fakeWs();
    const b = fakeWs();
    broadcastToClients([a, b], { hello: 'world' });
    expect(a.sent[0]).toBe(b.sent[0]);
    expect(a.sent[0]).toBe('{"hello":"world"}');
  });
});

describe('getOrCreateChannelSet', () => {
  it('creates a new set the first time a channel is seen', () => {
    const map = new Map();
    const s = getOrCreateChannelSet(map, 'ui');
    expect(s).toBeInstanceOf(Set);
    expect(map.get('ui')).toBe(s);
  });

  it('returns the same set for subsequent calls with the same channel', () => {
    const map = new Map();
    const first = getOrCreateChannelSet(map, 'ui');
    const second = getOrCreateChannelSet(map, 'ui');
    expect(second).toBe(first);
  });

  it('keeps multiple subscribers in one set (multi-tab shape)', () => {
    const map = new Map();
    const tabA = fakeWs();
    const tabB = fakeWs();
    getOrCreateChannelSet(map, 'ui').add(tabA);
    getOrCreateChannelSet(map, 'ui').add(tabB);

    const set = map.get('ui')!;
    expect(set.size).toBe(2);
    expect(set.has(tabA)).toBe(true);
    expect(set.has(tabB)).toBe(true);

    // And a broadcast fans out to both — the regression shape.
    broadcastToClients(set, { type: 'chunk', chunk: { type: 'done', sessionId: 'x' } });
    expect(tabA.sent).toHaveLength(1);
    expect(tabB.sent).toHaveLength(1);
  });

  it('keeps channels isolated from each other', () => {
    const map = new Map();
    getOrCreateChannelSet(map, 'ui').add(fakeWs());
    getOrCreateChannelSet(map, 'telegram:123').add(fakeWs());
    expect(map.get('ui')!.size).toBe(1);
    expect(map.get('telegram:123')!.size).toBe(1);
    expect(map.size).toBe(2);
  });
});
