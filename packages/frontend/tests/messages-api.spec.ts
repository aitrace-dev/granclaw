/**
 * Messages API — comprehensive test suite
 *
 * Tests GET /agents/:id/messages with every supported query param:
 *   limit, role, contains, from, to, sortBy, count, format=csv, channelId
 *
 * Design rules enforced by the API:
 *   - At least one query param is required (bare request → 400)
 *   - Default sort order is DESC (newest first)
 *   - Default limit is 50, capped at 200
 *   - count=true returns {count: N} with no rows
 *   - format=csv returns pipe-delimited timestamp|role|content
 *
 * No LLM required. Messages are seeded via POST /agents/:id/messages
 * with explicit `createdAt` timestamps for deterministic time-range tests.
 *
 * Seed layout (5 messages):
 *   [0] user      "I am thinking about real estate in Malaga"   48 h ago
 *   [1] assistant "Great, let me help you with that"            48 h ago + 1 s
 *   [2] user      "What are the best real estate agencies?"     24 h ago
 *   [3] user      "Also interested in property tax in Spain"    24 h ago + 1 s
 *   [4] assistant "Property tax in Spain is around 8-10%"      NOW
 */

import { test, expect } from '@playwright/test';

const API      = 'http://localhost:3001';
const AGENT_ID = 'test-messages-api-e2e';
const BASE     = `${API}/agents/${AGENT_ID}/messages`;

// ── Timestamps ────────────────────────────────────────────────────────────────

const NOW     = Date.now();
const H48_AGO = NOW - 48 * 60 * 60 * 1000;
const H24_AGO = NOW - 24 * 60 * 60 * 1000;

const toISO  = (ms: number) => new Date(ms).toISOString();
const dayISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── Seed data ─────────────────────────────────────────────────────────────────

const SEED = [
  { role: 'user',      content: 'I am thinking about real estate in Malaga',  createdAt: H48_AGO },
  { role: 'assistant', content: 'Great, let me help you with that',            createdAt: H48_AGO + 1_000 },
  { role: 'user',      content: 'What are the best real estate agencies?',     createdAt: H24_AGO },
  { role: 'user',      content: 'Also interested in property tax in Spain',    createdAt: H24_AGO + 1_000 },
  { role: 'assistant', content: 'Property tax in Spain is around 8-10%',       createdAt: NOW },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function get(params: Record<string, string | number | boolean>) {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return fetch(url.toString());
}

async function getJSON<T = unknown>(params: Record<string, string | number | boolean>): Promise<T> {
  const res = await get(params);
  expect(res.ok, `GET failed: HTTP ${res.status}`).toBe(true);
  return res.json() as Promise<T>;
}

async function getText(params: Record<string, string | number | boolean>): Promise<string> {
  const res = await get(params);
  expect(res.ok, `GET failed: HTTP ${res.status}`).toBe(true);
  return res.text();
}

type Msg = { id: string; agentId: string; role: string; content: string; createdAt: number };

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.describe('Messages API', () => {
  test.beforeAll(async () => {
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});

    const res = await fetch(`${API}/agents`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: AGENT_ID, name: AGENT_ID, workspaceDir: `.test/workspaces/${AGENT_ID}` }),
    });
    if (!res.ok) throw new Error(`Agent registration failed: ${await res.text()}`);

    for (const m of SEED) {
      const r = await fetch(BASE, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(m),
      });
      if (!r.ok) throw new Error(`Seed failed: ${await r.text()}`);
    }
  });

  test.afterAll(async () => {
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
  });

  // ── 400 on no params ──────────────────────────────────────────────────────────

  test('GET with no params returns 400', async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/query param required/i);
  });

  // ── limit ─────────────────────────────────────────────────────────────────────

  test('limit=5 returns all 5 seeded messages', async () => {
    const msgs = await getJSON<Msg[]>({ limit: 5 });
    expect(msgs.length).toBe(5);
    expect(msgs.every((m) => m.agentId === AGENT_ID)).toBe(true);
  });

  test('limit=2 returns only 2 messages', async () => {
    const msgs = await getJSON<Msg[]>({ limit: 2 });
    expect(msgs.length).toBe(2);
  });

  test('limit=1 returns the single newest message (default desc)', async () => {
    const msgs = await getJSON<Msg[]>({ limit: 1 });
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe(SEED[4].content);
  });

  // ── default sort (desc) ───────────────────────────────────────────────────────

  test('default sort is desc — first message is newest', async () => {
    const msgs = await getJSON<Msg[]>({ limit: 5 });
    expect(msgs[0].createdAt).toBeGreaterThan(msgs[4].createdAt);
    expect(msgs[0].content).toBe(SEED[4].content);
  });

  // ── sortBy ────────────────────────────────────────────────────────────────────

  test('sortBy=asc returns oldest first', async () => {
    const msgs = await getJSON<Msg[]>({ sortBy: 'asc', limit: 5 });
    expect(msgs[0].content).toBe(SEED[0].content);
    expect(msgs[4].content).toBe(SEED[4].content);
  });

  test('sortBy=desc returns newest first', async () => {
    const msgs = await getJSON<Msg[]>({ sortBy: 'desc', limit: 5 });
    expect(msgs[0].content).toBe(SEED[4].content);
    expect(msgs[4].content).toBe(SEED[0].content);
  });

  // ── count ─────────────────────────────────────────────────────────────────────

  test('count=true returns {count: 5}', async () => {
    const result = await getJSON<{ count: number }>({ count: true });
    expect(result).toHaveProperty('count', 5);
  });

  test('count=true + role=user returns {count: 3}', async () => {
    const result = await getJSON<{ count: number }>({ count: true, role: 'user' });
    expect(result).toHaveProperty('count', 3);
  });

  test('count=true + role=assistant returns {count: 2}', async () => {
    const result = await getJSON<{ count: number }>({ count: true, role: 'assistant' });
    expect(result).toHaveProperty('count', 2);
  });

  // ── role filter ───────────────────────────────────────────────────────────────

  test('role=user returns only user messages', async () => {
    const msgs = await getJSON<Msg[]>({ role: 'user' });
    expect(msgs.length).toBe(3);
    expect(msgs.every((m) => m.role === 'user')).toBe(true);
  });

  test('role=assistant returns only assistant messages', async () => {
    const msgs = await getJSON<Msg[]>({ role: 'assistant' });
    expect(msgs.length).toBe(2);
    expect(msgs.every((m) => m.role === 'assistant')).toBe(true);
  });

  // ── contains ──────────────────────────────────────────────────────────────────

  test('contains=real estate returns 2 messages', async () => {
    const msgs = await getJSON<Msg[]>({ contains: 'real estate' });
    expect(msgs.length).toBe(2);
    expect(msgs.every((m) => m.content.toLowerCase().includes('real estate'))).toBe(true);
  });

  test('contains=Spain returns 2 messages', async () => {
    const msgs = await getJSON<Msg[]>({ contains: 'Spain' });
    expect(msgs.length).toBe(2);
  });

  test('contains=nonexistent returns empty array', async () => {
    const msgs = await getJSON<Msg[]>({ contains: 'xyzzy_nonexistent_42' });
    expect(msgs).toEqual([]);
  });

  test('count=true + contains=real estate returns {count: 2}', async () => {
    const result = await getJSON<{ count: number }>({ count: true, contains: 'real estate' });
    expect(result).toHaveProperty('count', 2);
  });

  // ── from / to ─────────────────────────────────────────────────────────────────

  test('from=48h-ago ISO datetime returns all 5 messages', async () => {
    const msgs = await getJSON<Msg[]>({ from: toISO(H48_AGO - 1_000), limit: 10 });
    expect(msgs.length).toBe(5);
  });

  test('from=24h-ago ISO datetime returns last 3 messages', async () => {
    const msgs = await getJSON<Msg[]>({ from: toISO(H24_AGO - 1_000), limit: 10 });
    expect(msgs.length).toBe(3);
  });

  test('from=now ISO datetime returns only the most recent message', async () => {
    const msgs = await getJSON<Msg[]>({ from: toISO(NOW), limit: 10 });
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe(SEED[4].content);
  });

  test('to=48h-ago+2s ISO datetime returns only the first 2 messages', async () => {
    const msgs = await getJSON<Msg[]>({ to: toISO(H48_AGO + 2_000), limit: 10 });
    expect(msgs.length).toBe(2);
    expect(msgs.every((m) => m.createdAt <= H48_AGO + 2_000)).toBe(true);
  });

  test('from+to window around 24h-ago returns the 2 messages from that hour', async () => {
    const msgs = await getJSON<Msg[]>({
      from:  toISO(H24_AGO - 1_000),
      to:    toISO(H24_AGO + 2_000),
      limit: 10,
    });
    expect(msgs.length).toBe(2);
    expect(msgs.every((m) =>
      m.content.includes('real estate') || m.content.includes('property tax'),
    )).toBe(true);
  });

  test('from=future returns empty array', async () => {
    const msgs = await getJSON<Msg[]>({ from: toISO(NOW + 60_000), limit: 10 });
    expect(msgs).toEqual([]);
  });

  test('from=YYYY-MM-DD (today) returns at least the most recent message', async () => {
    const msgs = await getJSON<Msg[]>({ from: dayISO(NOW), limit: 10 });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.some((m) => m.content === SEED[4].content)).toBe(true);
  });

  // ── format=csv ────────────────────────────────────────────────────────────────

  test('format=csv returns pipe-delimited plain text', async () => {
    const text = await getText({ format: 'csv', limit: 5 });
    const lines = text.split('\n').filter(Boolean);
    expect(lines.length).toBe(5);
    for (const line of lines) {
      const [ts, role] = line.split('|');
      expect(Number(ts)).toBeGreaterThan(0);
      expect(['user', 'assistant', 'tool_call']).toContain(role);
    }
  });

  test('format=csv + role=user returns 3 lines all with role user', async () => {
    const text = await getText({ format: 'csv', role: 'user' });
    const lines = text.split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.split('|')[1] === 'user')).toBe(true);
  });

  test('format=csv + contains=real estate returns 2 lines', async () => {
    const text = await getText({ format: 'csv', contains: 'real estate' });
    const lines = text.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
  });

  test('format=csv default sort desc — first line timestamp > last line timestamp', async () => {
    const text = await getText({ format: 'csv', limit: 5 });
    const lines = text.split('\n').filter(Boolean);
    const firstTs = Number(lines[0].split('|')[0]);
    const lastTs  = Number(lines[lines.length - 1].split('|')[0]);
    expect(firstTs).toBeGreaterThan(lastTs);
  });

  test('format=csv + sortBy=asc — first line timestamp < last line timestamp', async () => {
    const text = await getText({ format: 'csv', sortBy: 'asc', limit: 5 });
    const lines = text.split('\n').filter(Boolean);
    const firstTs = Number(lines[0].split('|')[0]);
    const lastTs  = Number(lines[lines.length - 1].split('|')[0]);
    expect(firstTs).toBeLessThan(lastTs);
  });

  // ── combined filters ──────────────────────────────────────────────────────────

  test('role=user + contains=real estate + count=true → {count: 2}', async () => {
    const result = await getJSON<{ count: number }>({
      count:    true,
      role:     'user',
      contains: 'real estate',
    });
    expect(result).toHaveProperty('count', 2);
  });

  test('role=user + from=24h-ago + limit=1 returns 1 user message from that window', async () => {
    const msgs = await getJSON<Msg[]>({
      role:  'user',
      from:  toISO(H24_AGO - 1_000),
      limit: 1,
    });
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe('user');
  });

  test('role=assistant + from=24h-ago returns only the NOW assistant message', async () => {
    const msgs = await getJSON<Msg[]>({ role: 'assistant', from: toISO(H24_AGO - 1_000), limit: 10 });
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe(SEED[4].content);
  });

  test('channelId=ui scopes to the default channel', async () => {
    const msgs = await getJSON<Msg[]>({ channelId: 'ui', limit: 5 });
    expect(msgs.length).toBe(5);
    expect(msgs.every((m) => m.agentId === AGENT_ID)).toBe(true);
  });
});
