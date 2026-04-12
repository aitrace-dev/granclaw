/**
 * data-db.ts
 *
 * Singleton for the global system database.
 * DB file: <GRANCLAW_HOME>/data/system.sqlite
 *
 * Owns all global tables: messages, actions, secrets.
 * WAL mode — safe for concurrent writer (agent process) + reader (orchestrator).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { REPO_ROOT } from './config.js';

let _db: Database.Database | null = null;

/** Close and reset the singleton — use in tests only. */
export function closeDataDb(): void {
  _db?.close();
  _db = null;
}

export function getDataDb(): Database.Database {
  if (_db) return _db;

  const envPath = process.env.DATA_DB_PATH?.trim();
  const dbPath = envPath
    ? path.resolve(envPath)
    : path.join(path.resolve(REPO_ROOT, 'data'), 'system.sqlite');

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // Checkpoint any leftover WAL frames on open so new OS-level processes
  // (agent sub-processes) can open the same file without SQLITE_NOTADB errors.
  db.pragma('wal_checkpoint(TRUNCATE)');

  // ── messages table ───────────────────────────────────────────────────────
  // Migration: drop old table if it was created without the tool_call role.
  const messagesRow = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'`
  ).get()) as { sql: string } | undefined;
  if (messagesRow?.sql && !messagesRow.sql.includes('tool_call')) {
    db.exec(`DROP TABLE IF EXISTS messages`);
    console.log('[data-db] migrated messages table (added tool_call role)');
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

    -- ── actions table ──────────────────────────────────────────────────────
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

    -- ── takeovers table ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS takeovers (
      token       TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      reason      TEXT NOT NULL,
      url         TEXT,
      requested_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_takeovers_agent
      ON takeovers (agent_id);

    -- ── secrets table ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS secrets (
      agent_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      value       TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (agent_id, name)
    );
  `);

  _db = db;
  return db;
}
