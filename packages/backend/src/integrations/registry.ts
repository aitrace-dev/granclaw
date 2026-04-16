/**
 * integrations/registry.ts
 *
 * Global (per-install) integration configuration. Stored at
 * <GRANCLAW_HOME>/data/integrations.sqlite — separate file so integration
 * bookkeeping never gets mixed into the messages/logs DBs.
 *
 * `config` holds non-secret settings only (e.g. default proxy country).
 * API tokens and credentials go through app-secrets.ts.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { resolveGranclawHome } from '../config.js';
import { Integration } from './types.js';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dir = path.join(resolveGranclawHome(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'integrations.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id         TEXT PRIMARY KEY,
      enabled    INTEGER NOT NULL DEFAULT 0,
      config     TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

interface Row {
  id: string;
  enabled: number;
  config: string;
  created_at: string;
  updated_at: string;
}

function toIntegration(row: Row): Integration {
  return {
    id: row.id,
    enabled: row.enabled === 1,
    config: JSON.parse(row.config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getIntegration(id: string): Integration | null {
  const row = getDb().prepare('SELECT * FROM integrations WHERE id = ?').get(id) as Row | undefined;
  return row ? toIntegration(row) : null;
}

export function setIntegration(id: string, opts: { enabled: boolean; config: Record<string, unknown> }): void {
  getDb().prepare(`
    INSERT INTO integrations (id, enabled, config) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      config = excluded.config,
      updated_at = datetime('now')
  `).run(id, opts.enabled ? 1 : 0, JSON.stringify(opts.config));
}

export function listIntegrations(): Integration[] {
  const rows = getDb().prepare('SELECT * FROM integrations ORDER BY id').all() as Row[];
  return rows.map(toIntegration);
}

export function _resetForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
