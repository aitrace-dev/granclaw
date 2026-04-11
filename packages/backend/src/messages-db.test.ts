/**
 * messages-db.test.ts
 *
 * Unit tests for queryMessages — focuses on the `contains` filter:
 * multi-word phrases, case-insensitivity, and space handling.
 *
 * Uses DATA_DB_PATH env var + closeDataDb() to isolate each test to its
 * own temp SQLite file — no module reload tricks needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { saveMessage, queryMessages, getMessages } from './messages-db.js';
import { closeDataDb } from './data-db.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let tmp: string;
let msgSeq = 0;
const AGENT = 'test-agent';

function msg(content: string, role: 'user' | 'assistant' = 'user') {
  return saveMessage({
    id: randomUUID(),
    agentId: AGENT,
    channelId: 'ui',
    role,
    content,
    createdAt: 1_000_000 + (msgSeq++) * 1000, // deterministic ordering
  });
}

beforeEach(() => {
  msgSeq = 0;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-mdb-test-'));
  process.env.DATA_DB_PATH = path.join(tmp, 'system.sqlite');
});

afterEach(() => {
  closeDataDb();
  delete process.env.DATA_DB_PATH;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── contains filter ───────────────────────────────────────────────────────────

describe('queryMessages — contains', () => {
  it('finds a single-word match', () => {
    msg('Hello world');
    msg('Goodbye world');
    const result = queryMessages(AGENT, { contains: 'Hello' }) as { content: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello world');
  });

  it('finds a multi-word phrase with spaces', () => {
    msg('Cambalache Jazz Club is great');
    msg('Something else entirely');
    const result = queryMessages(AGENT, { contains: 'Cambalache Jazz Club' }) as { content: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Cambalache Jazz Club is great');
  });

  it('is case-insensitive — lowercase query finds mixed-case content', () => {
    msg('Cambalache Jazz Club');
    const result = queryMessages(AGENT, { contains: 'cambalache jazz club' }) as { content: string }[];
    expect(result).toHaveLength(1);
  });

  it('is case-insensitive — uppercase query finds mixed-case content', () => {
    msg('Cambalache Jazz Club');
    const result = queryMessages(AGENT, { contains: 'CAMBALACHE JAZZ' }) as { content: string }[];
    expect(result).toHaveLength(1);
  });

  it('is case-insensitive — mixed case query', () => {
    msg('cambalache jazz club');
    const result = queryMessages(AGENT, { contains: 'Cambalache Jazz' }) as { content: string }[];
    expect(result).toHaveLength(1);
  });

  it('returns all messages when contains is omitted', () => {
    msg('first');
    msg('second');
    msg('third');
    const result = queryMessages(AGENT, { limit: 10 }) as unknown[];
    expect(result).toHaveLength(3);
  });

  it('returns nothing when phrase is not found', () => {
    msg('Cambalache Jazz Club');
    const result = queryMessages(AGENT, { contains: 'Palermo' }) as unknown[];
    expect(result).toHaveLength(0);
  });

  it('matches a substring inside a longer message', () => {
    msg('I visited the Cambalache Jazz Club last night');
    const result = queryMessages(AGENT, { contains: 'Jazz Club' }) as { content: string }[];
    expect(result).toHaveLength(1);
  });

  it('does not cross-contaminate agents', () => {
    saveMessage({ id: randomUUID(), agentId: 'other-agent', channelId: 'ui', role: 'user', content: 'Cambalache Jazz Club' });
    const result = queryMessages(AGENT, { contains: 'Cambalache' }) as unknown[];
    expect(result).toHaveLength(0);
  });

  it('combines contains with role filter', () => {
    msg('Cambalache Jazz Club', 'user');
    msg('Cambalache Jazz Club response', 'assistant');
    const result = queryMessages(AGENT, { contains: 'Cambalache', role: 'assistant' }) as { role: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });
});

// ── getMessages ───────────────────────────────────────────────────────────────

describe('getMessages', () => {
  it('returns messages in ascending order', () => {
    msg('first');
    msg('second');
    msg('third');
    const result = getMessages(AGENT);
    expect(result.map(m => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('returns empty array for unknown agent', () => {
    expect(getMessages('no-such-agent')).toEqual([]);
  });
});
