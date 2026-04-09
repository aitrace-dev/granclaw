/**
 * schedules-db.ts
 *
 * Per-agent SQLite store for cron schedules.
 * DB file: <workspace>/schedules.sqlite (created lazily on first access).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { REPO_ROOT, getAgent } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type ScheduleStatus = 'active' | 'paused';

export interface Schedule {
  id: string;
  agentId: string;
  name: string;
  message: string;
  cron: string;
  timezone: string;
  status: ScheduleStatus;
  nextRun: number | null;
  lastRun: number | null;
  createdAt: number;
}

// ── Database pool ─────────────────────────────────────────────────────────

const dbPool = new Map<string, Database.Database>();

function getDb(agentId: string): Database.Database {
  const cached = dbPool.get(agentId);
  if (cached) return cached;

  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config`);

  const workspaceDir = path.resolve(REPO_ROOT, agent.workspaceDir);
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

  const dbPath = path.join(workspaceDir, 'schedules.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      name        TEXT NOT NULL,
      message     TEXT NOT NULL,
      cron        TEXT NOT NULL,
      timezone    TEXT NOT NULL DEFAULT 'Asia/Singapore',
      status      TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','paused')),
      next_run    INTEGER,
      last_run    INTEGER,
      created_at  INTEGER NOT NULL
    );
  `);

  dbPool.set(agentId, db);
  return db;
}

// ── Row mapper ────────────────────────────────────────────────────────────

function rowToSchedule(r: Record<string, unknown>): Schedule {
  return {
    id: r.id as string,
    agentId: r.agent_id as string,
    name: r.name as string,
    message: r.message as string,
    cron: r.cron as string,
    timezone: r.timezone as string,
    status: r.status as ScheduleStatus,
    nextRun: (r.next_run as number) ?? null,
    lastRun: (r.last_run as number) ?? null,
    createdAt: r.created_at as number,
  };
}

// ── ID generation ─────────────────────────────────────────────────────────

function nextScheduleId(db: Database.Database): string {
  const row = db.prepare(
    `SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1 AS next FROM schedules`
  ).get() as { next: number };
  return `SCH-${String(row.next).padStart(3, '0')}`;
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export function listSchedules(agentId: string): Schedule[] {
  const db = getDb(agentId);
  return (db.prepare(`SELECT * FROM schedules WHERE agent_id = ? ORDER BY created_at DESC`).all(agentId) as Record<string, unknown>[]).map(rowToSchedule);
}

export function getSchedule(agentId: string, scheduleId: string): Schedule | null {
  const db = getDb(agentId);
  const row = db.prepare(`SELECT * FROM schedules WHERE id = ? AND agent_id = ?`).get(scheduleId, agentId);
  return row ? rowToSchedule(row as Record<string, unknown>) : null;
}

export function createSchedule(agentId: string, data: {
  name: string;
  message: string;
  cron: string;
  timezone?: string;
  nextRun: number;
}): Schedule {
  const db = getDb(agentId);
  const id = nextScheduleId(db);
  const now = Date.now();
  db.prepare(`
    INSERT INTO schedules (id, agent_id, name, message, cron, timezone, status, next_run, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(id, agentId, data.name, data.message, data.cron, data.timezone ?? 'Asia/Singapore', data.nextRun, now);
  return getSchedule(agentId, id)!;
}

export function updateSchedule(agentId: string, scheduleId: string, data: {
  name?: string;
  message?: string;
  cron?: string;
  timezone?: string;
  status?: ScheduleStatus;
  nextRun?: number;
  lastRun?: number;
}): Schedule | null {
  const db = getDb(agentId);
  const existing = getSchedule(agentId, scheduleId);
  if (!existing) return null;

  db.prepare(`
    UPDATE schedules SET name = ?, message = ?, cron = ?, timezone = ?, status = ?, next_run = ?, last_run = ?
    WHERE id = ? AND agent_id = ?
  `).run(
    data.name ?? existing.name,
    data.message ?? existing.message,
    data.cron ?? existing.cron,
    data.timezone ?? existing.timezone,
    data.status ?? existing.status,
    data.nextRun ?? existing.nextRun,
    data.lastRun ?? existing.lastRun,
    scheduleId,
    agentId,
  );
  return getSchedule(agentId, scheduleId);
}

export function deleteSchedule(agentId: string, scheduleId: string): boolean {
  const db = getDb(agentId);
  const result = db.prepare(`DELETE FROM schedules WHERE id = ? AND agent_id = ?`).run(scheduleId, agentId);
  return result.changes > 0;
}

export function getDueSchedules(agentId: string): Schedule[] {
  const db = getDb(agentId);
  const now = Date.now();
  return (db.prepare(
    `SELECT * FROM schedules WHERE agent_id = ? AND status = 'active' AND next_run IS NOT NULL AND next_run <= ?`
  ).all(agentId, now) as Record<string, unknown>[]).map(rowToSchedule);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

export function closeSchedulesDb(agentId: string): void {
  const db = dbPool.get(agentId);
  if (db) {
    db.close();
    dbPool.delete(agentId);
  }
}
