/**
 * api.test.ts
 *
 * Covers the refresh-sync regression from bluggie (2026-04-21): after an
 * agent accumulated 319 UI messages, the chat page showed state from
 * several hours earlier even after a hard reload. Root cause was
 * `fetchMessages` calling the /messages endpoint with `sortBy=asc&limit=200`,
 * which returns the OLDEST 200 rows and silently drops the newest 119.
 *
 * The contract these tests lock in:
 *   1. Query uses sortBy=desc + limit + channelId — so the server returns
 *      the latest rows, not the oldest.
 *   2. The client reverses to chronological order before returning — so
 *      the consumer (ChatPage) can keep rendering oldest→newest as
 *      before without a conditional sort.
 *   3. cache: 'no-store' — prevents the Tab-A-never-syncs bug when two
 *      tabs are open on the same agent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchMessages, type ChatMessage } from './api.ts';

// ChatMessage rows as the server would return them with sortBy=desc —
// newest first. The function under test must reverse to oldest first.
const SERVER_ROWS_DESC: ChatMessage[] = [
  { id: 'm3', agentId: 'bluggie', channelId: 'ui', role: 'user',      content: 'third',  createdAt: 3 },
  { id: 'm2', agentId: 'bluggie', channelId: 'ui', role: 'assistant', content: 'second', createdAt: 2 },
  { id: 'm1', agentId: 'bluggie', channelId: 'ui', role: 'user',      content: 'first',  createdAt: 1 },
];

describe('fetchMessages', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [...SERVER_ROWS_DESC],
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests sortBy=desc (not asc) so limit-capped results are the newest rows', async () => {
    await fetchMessages('bluggie');

    const [url] = fetchMock.mock.calls[0];
    const query = new URL(url as string, 'http://localhost').searchParams;
    expect(query.get('sortBy')).toBe('desc');
    expect(query.get('sortBy')).not.toBe('asc');
  });

  it('includes channelId and a non-zero limit in the query', async () => {
    await fetchMessages('bluggie', 'ui');

    const [url] = fetchMock.mock.calls[0];
    const query = new URL(url as string, 'http://localhost').searchParams;
    expect(query.get('channelId')).toBe('ui');
    expect(Number(query.get('limit'))).toBeGreaterThan(0);
  });

  it('defaults channelId to "ui" when omitted', async () => {
    await fetchMessages('bluggie');

    const [url] = fetchMock.mock.calls[0];
    const query = new URL(url as string, 'http://localhost').searchParams;
    expect(query.get('channelId')).toBe('ui');
  });

  it('passes cache: no-store so two-tab refresh sees fresh rows', async () => {
    await fetchMessages('bluggie');

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit | undefined)?.cache).toBe('no-store');
  });

  it('reverses the server response into chronological order for the consumer', async () => {
    const rows = await fetchMessages('bluggie');

    expect(rows.map((r) => r.id)).toEqual(['m1', 'm2', 'm3']);
    expect(rows[0].createdAt).toBeLessThan(rows[rows.length - 1].createdAt);
  });

  it('escalates a non-ok response to a thrown error with the status code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(fetchMessages('bluggie')).rejects.toThrow(/500/);
  });

  it('url-encodes custom channel ids with special characters (schedule run channels use dashes/underscores)', async () => {
    await fetchMessages('bluggie', 'sched_2026-04-21');

    const [url] = fetchMock.mock.calls[0];
    const query = new URL(url as string, 'http://localhost').searchParams;
    expect(query.get('channelId')).toBe('sched_2026-04-21');
  });
});
