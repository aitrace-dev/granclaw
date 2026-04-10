/**
 * agent-db.ts
 *
 * Per-agent SQLite store for sessions and job queue.
 * DB file: <workspaceDir>/agent.db (created lazily on first access).
 * Deleted automatically when the workspace is wiped (fs.rmSync).
 *
 * Pool is keyed by workspaceDir (not agentId) so it works even if
 * two agents share a workspace path (shouldn't happen, but safe).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

// ── Pool ──────────────────────────────────────────────────────────────────────

const dbPool = new Map<string, Database.Database>();

function getDb(workspaceDir: string): Database.Database {
  const cached = dbPool.get(workspaceDir);
  if (cached) return cached;

  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

  const dbPath = path.join(workspaceDir, 'agent.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      agent_id     TEXT    NOT NULL,
      channel_id   TEXT    NOT NULL DEFAULT 'ui',
      session_id   TEXT    NOT NULL DEFAULT '',
      session_file TEXT,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (agent_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT    PRIMARY KEY,
      agent_id    TEXT    NOT NULL,
      channel_id  TEXT    NOT NULL DEFAULT 'ui',
      message     TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'processing', 'done', 'failed')),
      created_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_dequeue
      ON jobs (agent_id, status, created_at);
  `);

  const existingCols = (db.pragma('table_info(sessions)') as Array<{ name: string }>).map(c => c.name);
  if (!existingCols.includes('session_file')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN session_file TEXT`);
  }

  db.pragma('foreign_keys = ON');

  dbPool.set(workspaceDir, db);
  return db;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function getSession(workspaceDir: string, agentId: string, channelId = 'ui'): string | null {
  const db = getDb(workspaceDir);
  const row = db.prepare(
    `SELECT session_id FROM sessions WHERE agent_id = ? AND channel_id = ?`
  ).get(agentId, channelId) as { session_id: string } | undefined;
  return row?.session_id || null;
}

export function saveSession(
  workspaceDir: string,
  agentId: string,
  sessionId: string,
  channelId = 'ui',
  sessionFile?: string
): void {
  const db = getDb(workspaceDir);
  db.prepare(`
    INSERT INTO sessions (agent_id, channel_id, session_id, session_file, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, channel_id) DO UPDATE SET
      session_id = excluded.session_id,
      session_file = excluded.session_file,
      updated_at = excluded.updated_at
  `).run(agentId, channelId, sessionId, sessionFile ?? null, Date.now());
}

// ── Job queue ─────────────────────────────────────────────────────────────────

export function enqueue(workspaceDir: string, agentId: string, message: string, channelId = 'ui'): string {
  const db = getDb(workspaceDir);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO jobs (id, agent_id, channel_id, message, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, agentId, channelId, message, Date.now());
  return id;
}

export function dequeueNext(workspaceDir: string, agentId: string, skipChannelTypes?: Set<string>): { id: string; message: string; channelId: string } | null {
  const db = getDb(workspaceDir);

  const dequeue = db.transaction(() => {
    // Get several pending jobs so we can skip busy channel types
    const rows = db.prepare(`
      SELECT id, message, channel_id FROM jobs
      WHERE agent_id = ? AND status = 'pending'
      ORDER BY created_at ASC LIMIT 10
    `).all(agentId) as { id: string; message: string; channel_id: string }[];

    for (const row of rows) {
      // If caller wants to skip certain channel types, check
      if (skipChannelTypes) {
        const lane = row.channel_id.startsWith('wf-') ? 'workflow'
          : row.channel_id === 'schedule' ? 'schedule'
          : row.channel_id;
        if (skipChannelTypes.has(lane)) continue;
      }

      db.prepare(`UPDATE jobs SET status = 'processing' WHERE id = ?`).run(row.id);
      return { id: row.id, message: row.message, channelId: row.channel_id };
    }

    return null;
  });

  return dequeue() as { id: string; message: string; channelId: string } | null;
}

export function markDone(workspaceDir: string, jobId: string): void {
  const db = getDb(workspaceDir);
  db.prepare(`UPDATE jobs SET status = 'done' WHERE id = ?`).run(jobId);
}

export function markFailed(workspaceDir: string, jobId: string): void {
  const db = getDb(workspaceDir);
  db.prepare(`UPDATE jobs SET status = 'failed' WHERE id = ?`).run(jobId);
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/** Mark all 'processing' jobs as 'failed' — used on startup to clean up after crashes */
export function cleanupStaleJobs(workspaceDir: string): number {
  const db = getDb(workspaceDir);
  const result = db.prepare(`UPDATE jobs SET status = 'failed' WHERE status = 'processing'`).run();
  return result.changes;
}

// ── Monitor ──────────────────────────────────────────────────────────────────

export function getActiveJobs(workspaceDir: string, agentId: string): { id: string; channelId: string; status: string; message: string; createdAt: number }[] {
  const db = getDb(workspaceDir);
  const rows = db.prepare(`
    SELECT id, channel_id, status, message, created_at FROM jobs
    WHERE agent_id = ? AND status IN ('pending', 'processing')
    ORDER BY created_at ASC
  `).all(agentId) as { id: string; channel_id: string; status: string; message: string; created_at: number }[];

  return rows.map(r => ({
    id: r.id,
    channelId: r.channel_id,
    status: r.status,
    message: r.message.slice(0, 200),
    createdAt: r.created_at,
  }));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function closeAgentDb(workspaceDir: string): void {
  const db = dbPool.get(workspaceDir);
  if (db) {
    db.close();
    dbPool.delete(workspaceDir);
  }
}
