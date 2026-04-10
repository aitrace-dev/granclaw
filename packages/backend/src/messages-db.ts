/**
 * messages-db.ts
 *
 * SQLite store for chat message history — used by the UI to restore conversations.
 * The agent handles its own Claude session memory separately.
 *
 * DB file: <repo-root>/data/messages.db
 */

import Database from 'better-sqlite3';
import path from 'path';
import { REPO_ROOT } from './config.js';
import fs from 'fs';

// ── Setup ─────────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(REPO_ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'messages.db'));

// Enable WAL mode so multiple processes (orchestrator + agent) can write concurrently
db.pragma('journal_mode = WAL');

// Migration: drop old table if it was created without the tool_call role
const tableRow = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'`).get()) as { sql: string } | undefined;
if (tableRow?.sql && !tableRow.sql.includes('tool_call')) {
  db.exec(`DROP TABLE IF EXISTS messages`);
  console.log('[messages-db] migrated messages table (added tool_call role)');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT    PRIMARY KEY,
    agent_id    TEXT    NOT NULL,
    channel_id  TEXT    NOT NULL DEFAULT 'ui',
    role        TEXT    NOT NULL CHECK(role IN ('user', 'assistant', 'tool_call')),
    content     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_agent_channel
    ON messages (agent_id, channel_id, created_at);
`);

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

const stmtInsert = db.prepare<[string, string, string, string, string, number]>(`
  INSERT INTO messages (id, agent_id, channel_id, role, content, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtList = db.prepare<[string, string, number]>(`
  SELECT * FROM (
    SELECT id, agent_id, channel_id, role, content, created_at
    FROM messages
    WHERE agent_id = ? AND channel_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  ) ORDER BY created_at ASC
`);

export function saveMessage(msg: Omit<Message, 'createdAt'> & { createdAt?: number }): Message {
  const createdAt = msg.createdAt ?? Date.now();
  stmtInsert.run(msg.id, msg.agentId, msg.channelId, msg.role as string, msg.content, createdAt);
  return { ...msg, createdAt };
}

export function deleteMessages(agentId: string): void {
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(agentId);
}

export function getMessages(agentId: string, channelId = 'ui', limit = 200): Message[] {
  const rows = stmtList.all(agentId, channelId, limit) as {
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
  contains?: string;                             // LIKE %text% on content
  from?: string;                                 // ISO date or datetime (inclusive)
  to?: string;                                   // ISO date or datetime (inclusive)
  role?: 'user' | 'assistant' | 'tool_call';
  sortBy?: 'asc' | 'desc';
  limit?: number;                                // capped at 200, default 50
  count?: boolean;                               // return {count:N} only
}

function isoToMs(iso: string): number {
  // Accept 'YYYY-MM-DD' (midnight UTC) or full ISO datetime
  return new Date(iso.includes('T') ? iso : `${iso}T00:00:00.000Z`).getTime();
}

export function queryMessages(
  agentId: string,
  query: MessageQuery = {},
): Message[] | { count: number } {
  const { channelId, contains, from, to, role, sortBy = 'asc', limit = 50, count = false } = query;

  const clauses: string[] = ['agent_id = ?'];
  const params: unknown[] = [agentId];

  if (channelId) { clauses.push('channel_id = ?'); params.push(channelId); }
  if (contains)  { clauses.push('content LIKE ?');  params.push(`%${contains}%`); }
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
