/**
 * secrets-vault.ts
 *
 * Per-agent secrets store backed by SQLite.
 * DB file: <repo-root>/data/secrets.db
 *
 * The orchestrator reads secrets at agent spawn time and injects them
 * as env vars into the child process. The agent never accesses this DB.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { REPO_ROOT } from './config.js';

const DATA_DIR = path.resolve(REPO_ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'secrets.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS secrets (
    agent_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    value       TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (agent_id, name)
  );
`);

// ── Prepared statements ─────────────────────────────────────────────────

const stmtList = db.prepare<[string]>(
  `SELECT name FROM secrets WHERE agent_id = ? ORDER BY created_at`
);

const stmtGetAll = db.prepare<[string]>(
  `SELECT name, value FROM secrets WHERE agent_id = ?`
);

const stmtUpsert = db.prepare<[string, string, string]>(
  `INSERT INTO secrets (agent_id, name, value) VALUES (?, ?, ?)
   ON CONFLICT(agent_id, name) DO UPDATE SET value = excluded.value`
);

const stmtDelete = db.prepare<[string, string]>(
  `DELETE FROM secrets WHERE agent_id = ? AND name = ?`
);

const stmtDeleteAll = db.prepare<[string]>(
  `DELETE FROM secrets WHERE agent_id = ?`
);

// ── Public API (same interface as before) ───────────────────────────────

export function listSecretNames(agentId: string): string[] {
  return (stmtList.all(agentId) as { name: string }[]).map((r) => r.name);
}

export function getSecrets(agentId: string): Record<string, string> {
  const rows = stmtGetAll.all(agentId) as { name: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

export function setSecret(agentId: string, name: string, value: string): void {
  stmtUpsert.run(agentId, name, value);
}

export function deleteSecret(agentId: string, name: string): void {
  stmtDelete.run(agentId, name);
}

export function deleteAllSecrets(agentId: string): void {
  stmtDeleteAll.run(agentId);
}
