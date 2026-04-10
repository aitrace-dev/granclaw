/**
 * logs-db.ts
 *
 * Shared SQLite audit log for all agents.
 * DB file: <REPO_ROOT>/data/logs.db (created lazily on first access).
 * WAL mode — safe for concurrent writer (agent process) + reader (orchestrator).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { REPO_ROOT } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActionRow {
  id: string;
  agent_id: string;
  type: string;
  input: string | null;
  output: string | null;
  duration_ms: number | null;
  created_at: number;
}

export type ActionType = 'message' | 'tool_call' | 'tool_result' | 'error' | 'system';

// ── Singleton DB ──────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = path.resolve(REPO_ROOT, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'logs.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // Checkpoint any leftover WAL frames on open so new OS-level processes
  // (agent sub-processes) can open the same file without SQLITE_NOTADB errors
  // caused by a stale WAL that was never flushed by a previous run.
  db.pragma('wal_checkpoint(TRUNCATE)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS actions (
      id          TEXT    PRIMARY KEY,
      agent_id    TEXT    NOT NULL,
      type        TEXT    NOT NULL
                  CHECK(type IN ('message', 'tool_call', 'tool_result', 'error', 'system')),
      input       TEXT,
      output      TEXT,
      duration_ms INTEGER,
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_actions_lookup
      ON actions (agent_id, created_at);
  `);

  _db = db;
  return db;
}

// ── Writes ────────────────────────────────────────────────────────────────────

export function logAction(
  agentId: string,
  type: ActionType,
  input?: unknown,
  output?: unknown,
  durationMs?: number
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO actions (id, agent_id, type, input, output, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    agentId,
    type,
    input !== undefined ? JSON.stringify(input) : null,
    output !== undefined ? JSON.stringify(output) : null,
    durationMs ?? null,
    Date.now(),
  );
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function queryActions(params: {
  agentId?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): { items: ActionRow[]; total: number } {
  const db = getDb();
  const { agentId, type, search, limit = 50, offset = 0 } = params;

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (agentId) { conditions.push('agent_id = ?'); bindings.push(agentId); }
  if (type) { conditions.push('type = ?'); bindings.push(type); }
  if (search) {
    conditions.push('(input LIKE ? OR output LIKE ?)');
    const term = `%${search}%`;
    bindings.push(term, term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const items = db.prepare(
    `SELECT * FROM actions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...bindings, limit, offset) as ActionRow[];

  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM actions ${where}`
  ).get(...bindings) as { total: number };

  return { items, total };
}
