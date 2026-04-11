/**
 * schedules-db.ts
 *
 * Per-agent SQLite store for cron schedules.
 * Backed by <workspaceDir>/agent.sqlite (shared via workspace-pool).
 */

import path from 'path';
import { randomUUID } from 'crypto';
import { REPO_ROOT, getAgent } from './config.js';
import { getWorkspaceDb, closeWorkspaceDb } from './workspace-pool.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type ScheduleStatus = 'active' | 'paused';

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  agentId: string;
  channelId: string;
  startedAt: number;
}

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

// ── Internal DB accessor ──────────────────────────────────────────────────

function getDb(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config`);
  return getWorkspaceDb(path.resolve(REPO_ROOT, agent.workspaceDir));
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

function nextScheduleId(db: ReturnType<typeof getWorkspaceDb>): string {
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

// ── Schedule Runs ─────────────────────────────────────────────────────────

export function createScheduleRun(agentId: string, scheduleId: string): ScheduleRun {
  const db = getDb(agentId);
  const id = randomUUID();
  const channelId = `sch-${id}`;
  const startedAt = Date.now();
  db.prepare(`
    INSERT INTO schedule_runs (id, schedule_id, agent_id, channel_id, started_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, scheduleId, agentId, channelId, startedAt);
  return { id, scheduleId, agentId, channelId, startedAt };
}

export function listScheduleRuns(agentId: string, scheduleId: string, limit = 20): ScheduleRun[] {
  const db = getDb(agentId);
  const rows = db.prepare(`
    SELECT id, schedule_id, agent_id, channel_id, started_at
    FROM schedule_runs
    WHERE schedule_id = ? AND agent_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(scheduleId, agentId, limit) as {
    id: string; schedule_id: string; agent_id: string; channel_id: string; started_at: number;
  }[];
  return rows.map(r => ({
    id: r.id, scheduleId: r.schedule_id, agentId: r.agent_id,
    channelId: r.channel_id, startedAt: r.started_at,
  }));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

export function closeSchedulesDb(agentId: string): void {
  const agent = getAgent(agentId);
  if (!agent) return;
  closeWorkspaceDb(path.resolve(REPO_ROOT, agent.workspaceDir));
}
