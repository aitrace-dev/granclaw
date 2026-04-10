/**
 * messages-db.ts
 *
 * SQLite store for chat message history — used by the UI to restore conversations.
 * Backed by data/system.sqlite (shared global DB via getDataDb()).
 */

import { randomUUID } from 'crypto';
import { getDataDb } from './data-db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  agentId: string;
  channelId: string;
  role: 'user' | 'assistant' | 'tool_call';
  content: string;
  createdAt: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function saveMessage(msg: Omit<Message, 'createdAt'> & { createdAt?: number }): Message {
  const db = getDataDb();
  const createdAt = msg.createdAt ?? Date.now();
  db.prepare(`
    INSERT INTO messages (id, agent_id, channel_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.agentId, msg.channelId, msg.role as string, msg.content, createdAt);
  return { ...msg, createdAt };
}

export function deleteMessages(agentId: string): void {
  getDataDb().prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId);
}

export function getMessages(agentId: string, channelId = 'ui', limit = 200): Message[] {
  const db = getDataDb();
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT id, agent_id, channel_id, role, content, created_at
      FROM messages
      WHERE agent_id = ? AND channel_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) ORDER BY created_at ASC
  `).all(agentId, channelId, limit) as {
    id: string; agent_id: string; channel_id: string;
    role: string; content: string; created_at: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    channelId: r.channel_id,
    role: r.role as 'user' | 'assistant' | 'tool_call',
    content: r.content,
    createdAt: r.created_at,
  }));
}

// ── Queryable search ─────────────────────────────────────────────────────────

export interface MessageQuery {
  channelId?: string;
  contains?: string;
  from?: string;
  to?: string;
  role?: 'user' | 'assistant' | 'tool_call';
  sortBy?: 'asc' | 'desc';
  limit?: number;
  count?: boolean;
}

function isoToMs(iso: string): number {
  return new Date(iso.includes('T') ? iso : `${iso}T00:00:00.000Z`).getTime();
}

export function queryMessages(
  agentId: string,
  query: MessageQuery = {},
): Message[] | { count: number } {
  const db = getDataDb();
  const { channelId, contains, from, to, role, sortBy = 'desc', limit = 50, count = false } = query;

  const clauses: string[] = ['agent_id = ?'];
  const params: unknown[] = [agentId];

  if (channelId) { clauses.push('channel_id = ?'); params.push(channelId); }
  if (contains)  { clauses.push('LOWER(content) LIKE LOWER(?)');  params.push(`%${contains}%`); }
  if (from)      { clauses.push('created_at >= ?'); params.push(isoToMs(from)); }
  if (to)        { clauses.push('created_at <= ?'); params.push(isoToMs(to)); }
  if (role)      { clauses.push('role = ?');        params.push(role); }

  const where = clauses.join(' AND ');

  if (count) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE ${where}`)
      .get(...params as []) as { n: number };
    return { count: row.n };
  }

  const cappedLimit = Math.min(limit, 200);
  const order = sortBy === 'desc' ? 'DESC' : 'ASC';

  const rows = db.prepare(`
    SELECT id, agent_id, channel_id, role, content, created_at
    FROM messages WHERE ${where}
    ORDER BY created_at ${order} LIMIT ?
  `).all(...params as [], cappedLimit) as {
    id: string; agent_id: string; channel_id: string;
    role: string; content: string; created_at: number;
  }[];

  return rows.map((r) => ({
    id: r.id, agentId: r.agent_id, channelId: r.channel_id,
    role: r.role as Message['role'], content: r.content, createdAt: r.created_at,
  }));
}

/** Get recent messages across ALL channels for an agent, ordered by time */
export function getAllRecentMessages(agentId: string, limit = 50): Message[] {
  const db = getDataDb();
  const rows = db.prepare(`
    SELECT id, agent_id, channel_id, role, content, created_at
    FROM messages
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(agentId, limit) as {
    id: string; agent_id: string; channel_id: string;
    role: string; content: string; created_at: number;
  }[];

  return rows.reverse().map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    channelId: r.channel_id,
    role: r.role as 'user' | 'assistant' | 'tool_call',
    content: r.content,
    createdAt: r.created_at,
  }));
}
