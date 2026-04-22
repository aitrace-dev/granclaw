/**
 * tasks-db.ts
 *
 * Per-agent SQLite store for kanban tasks, columns, and comments.
 * Backed by <workspaceDir>/agent.sqlite (shared via workspace-pool).
 */

import path from 'path';
import { randomUUID } from 'crypto';
import { REPO_ROOT, getAgent } from './config.js';
import { getWorkspaceDb, closeWorkspaceDb } from './workspace-pool.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type Source = 'agent' | 'human';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  tags: string[];
  source: Source;
  updatedBy: Source | null;
  createdAt: number;
  updatedAt: number;
}

export interface Comment {
  id: string;
  taskId: string;
  body: string;
  source: Source;
  createdAt: number;
}

export interface TaskColumn {
  id: string;
  label: string;
  position: number;
  createdAt: number;
}

// ── Internal DB accessor ───────────────────────────────────────────────────

function getDb(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config`);
  return getWorkspaceDb(path.resolve(REPO_ROOT, agent.workspaceDir));
}

// ── Row mappers ─────────────────────────────────────────────────────────

function rowToTask(r: Record<string, unknown>): Task {
  const tagsStr = (r.tags as string) || '';
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    status: r.status as string,
    tags: tagsStr ? tagsStr.split(',') : [],
    source: r.source as Source,
    updatedBy: (r.updated_by as Source) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function rowToComment(r: Record<string, unknown>): Comment {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    body: r.body as string,
    source: r.source as Source,
    createdAt: r.created_at as number,
  };
}

function rowToColumn(r: Record<string, unknown>): TaskColumn {
  return {
    id: r.id as string,
    label: r.label as string,
    position: r.position as number,
    createdAt: r.created_at as number,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'column';
}

// ── Task CRUD ──────────────────────────────────────────────────────────

function nextTaskId(db: ReturnType<typeof getWorkspaceDb>): string {
  const row = db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1 AS next FROM tasks`).get() as { next: number };
  return `TSK-${String(row.next).padStart(3, '0')}`;
}

export function listTasks(agentId: string, opts?: { status?: string; search?: string; tags?: string[] }): Task[] {
  const db = getDb(agentId);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts?.search) {
    conditions.push('(title LIKE ? OR description LIKE ?)');
    const term = `%${opts.search}%`;
    params.push(term, term);
  }
  if (opts?.tags?.length) {
    for (const tag of opts.tags) {
      conditions.push("(',' || tags || ',' LIKE ?)");
      params.push(`%,${tag},%`);
    }
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  return (db.prepare(`SELECT * FROM tasks${where} ORDER BY created_at`).all(...params) as Record<string, unknown>[]).map(rowToTask);
}

export function getTask(agentId: string, taskId: string): Task | null {
  const db = getDb(agentId);
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
  return row ? rowToTask(row as Record<string, unknown>) : null;
}

export function createTask(agentId: string, data: { title: string; description?: string; status?: string; tags?: string[] }): Task {
  const db = getDb(agentId);
  const id = nextTaskId(db);
  const now = Math.floor(Date.now() / 1000);
  const tagsStr = (data.tags ?? []).join(',');
  db.prepare(`
    INSERT INTO tasks (id, title, description, status, tags, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'human', ?, ?)
  `).run(id, data.title, data.description ?? '', data.status ?? 'to_do', tagsStr, now, now);
  return getTask(agentId, id)!;
}

export function updateTask(agentId: string, taskId: string, data: { title?: string; description?: string; status?: string; tags?: string[] }): Task | null {
  const db = getDb(agentId);
  const existing = getTask(agentId, taskId);
  if (!existing) return null;
  const now = Math.floor(Date.now() / 1000);
  const tagsStr = data.tags !== undefined ? data.tags.join(',') : existing.tags.join(',');
  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, status = ?, tags = ?, updated_by = 'human', updated_at = ?
    WHERE id = ?
  `).run(
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.status ?? existing.status,
    tagsStr,
    now,
    taskId,
  );
  return getTask(agentId, taskId);
}

export function deleteTask(agentId: string, taskId: string): boolean {
  const db = getDb(agentId);
  const result = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
  return result.changes > 0;
}

export function clearTasks(agentId: string): number {
  const db = getDb(agentId);
  const result = db.prepare('DELETE FROM tasks').run();
  return result.changes;
}

// ── Column CRUD ────────────────────────────────────────────────────────

export function listColumns(agentId: string): TaskColumn[] {
  const db = getDb(agentId);
  return (db.prepare('SELECT * FROM task_columns ORDER BY position').all() as Record<string, unknown>[]).map(rowToColumn);
}

export function createColumn(agentId: string, data: { label: string }): TaskColumn {
  const db = getDb(agentId);
  const id = slugify(data.label);
  const existing = db.prepare('SELECT id FROM task_columns WHERE id = ?').get(id);
  if (existing) throw new Error(`Column "${id}" already exists`);
  const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM task_columns').get() as { next: number }).next;
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO task_columns (id, label, position, created_at) VALUES (?, ?, ?, ?)').run(id, data.label, maxPos, now);
  return { id, label: data.label, position: maxPos, createdAt: now };
}

export function deleteColumn(agentId: string, columnId: string): boolean {
  const db = getDb(agentId);
  const count = (db.prepare('SELECT COUNT(*) as n FROM task_columns').get() as { n: number }).n;
  if (count <= 1) throw new Error('Cannot delete the last column');
  const firstCol = db.prepare('SELECT id FROM task_columns WHERE id != ? ORDER BY position LIMIT 1').get(columnId) as { id: string } | undefined;
  if (firstCol) {
    db.prepare('UPDATE tasks SET status = ? WHERE status = ?').run(firstCol.id, columnId);
  }
  const result = db.prepare('DELETE FROM task_columns WHERE id = ?').run(columnId);
  return result.changes > 0;
}

// ── Comment CRUD ──────────────────────────────────────────────────────

export function listComments(agentId: string, taskId: string): Comment[] {
  const db = getDb(agentId);
  return (db.prepare(`SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC`).all(taskId) as Record<string, unknown>[]).map(rowToComment);
}

export function createComment(agentId: string, taskId: string, body: string): Comment {
  const db = getDb(agentId);
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO comments (id, task_id, body, source, created_at) VALUES (?, ?, ?, 'human', ?)`).run(id, taskId, body, now);
  return { id, taskId, body, source: 'human', createdAt: now };
}

// ── Cleanup ──────────────────────────────────────────────────────────

export function closeTasksDb(agentId: string): void {
  const agent = getAgent(agentId);
  if (!agent) return;
  closeWorkspaceDb(path.resolve(REPO_ROOT, agent.workspaceDir));
}
