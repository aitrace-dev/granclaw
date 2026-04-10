/**
 * tasks-db.ts
 *
 * Per-agent SQLite store for kanban tasks.
 * Backed by <workspaceDir>/agent.sqlite (shared via workspace-pool).
 */

import path from 'path';
import { randomUUID } from 'crypto';
import { REPO_ROOT, getAgent } from './config.js';
import { getWorkspaceDb, closeWorkspaceDb } from './workspace-pool.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type TaskStatus = 'backlog' | 'in_progress' | 'scheduled' | 'to_review' | 'done';
export type Source = 'agent' | 'human';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
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

// ── Internal DB accessor ───────────────────────────────────────────────────

function getDb(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent "${agentId}" not found in config`);
  return getWorkspaceDb(path.resolve(REPO_ROOT, agent.workspaceDir));
}

// ── Row mappers ─────────────────────────────────────────────────────────

function rowToTask(r: Record<string, unknown>): Task {
  return {
    id: r.id as string,
    title: r.title as string,
    description: r.description as string,
    status: r.status as TaskStatus,
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

// ── Task CRUD ──────────────────────────────────────────────────────────

function nextTaskId(db: ReturnType<typeof getWorkspaceDb>): string {
  const row = db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1 AS next FROM tasks`).get() as { next: number };
  return `TSK-${String(row.next).padStart(3, '0')}`;
}

export function listTasks(agentId: string, status?: string): Task[] {
  const db = getDb(agentId);
  if (status) {
    return (db.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at`).all(status) as Record<string, unknown>[]).map(rowToTask);
  }
  return (db.prepare(`SELECT * FROM tasks ORDER BY created_at`).all() as Record<string, unknown>[]).map(rowToTask);
}

export function getTask(agentId: string, taskId: string): Task | null {
  const db = getDb(agentId);
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
  return row ? rowToTask(row as Record<string, unknown>) : null;
}

export function createTask(agentId: string, data: { title: string; description?: string; status?: TaskStatus }): Task {
  const db = getDb(agentId);
  const id = nextTaskId(db);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO tasks (id, title, description, status, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'human', ?, ?)
  `).run(id, data.title, data.description ?? '', data.status ?? 'backlog', now, now);
  return getTask(agentId, id)!;
}

export function updateTask(agentId: string, taskId: string, data: { title?: string; description?: string; status?: TaskStatus }): Task | null {
  const db = getDb(agentId);
  const existing = getTask(agentId, taskId);
  if (!existing) return null;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, status = ?, updated_by = 'human', updated_at = ?
    WHERE id = ?
  `).run(
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.status ?? existing.status,
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
