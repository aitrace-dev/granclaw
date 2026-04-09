/**
 * workflows-db.ts
 *
 * Per-agent SQLite store for workflows, steps, runs, and run steps.
 * DB file: <workspace>/workflows.sqlite (created lazily on first access).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { REPO_ROOT, getAgent } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type WorkflowStatus = 'active' | 'paused' | 'archived';
export type StepType = 'code' | 'llm' | 'agent';
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Step {
  id: string;
  workflowId: string;
  position: number;
  name: string;
  type: StepType;
  config: Record<string, unknown>;
  transitions: { conditions: { expr: string; goto: string }[] } | null;
}

export interface WorkflowWithSteps extends Workflow {
  steps: Step[];
}

export interface Run {
  id: string;
  workflowId: string;
  status: RunStatus;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface RunStep {
  id: string;
  runId: string;
  stepId: string;
  status: RunStepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
}

export interface RunWithSteps extends Run {
  steps: RunStep[];
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

  const dbPath = path.join(workspaceDir, 'workflows.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active'
                    CHECK(status IN ('active','paused','archived')),
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS steps (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('code','llm','agent')),
      config      TEXT NOT NULL,
      transitions TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_steps_workflow ON steps(workflow_id, position);

    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'running'
                    CHECK(status IN ('running','completed','failed','cancelled')),
      trigger     TEXT NOT NULL CHECK(trigger IN ('manual','chat')),
      started_at  INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id, started_at);

    CREATE TABLE IF NOT EXISTS run_steps (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id     TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','running','completed','failed','skipped')),
      input       TEXT,
      output      TEXT,
      error       TEXT,
      started_at  INTEGER,
      finished_at INTEGER,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, started_at);
  `);

  // Migration: add 'agent' to steps.type CHECK constraint for existing DBs
  const stepsSchema = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='steps'`).get() as { sql: string } | undefined);
  if (stepsSchema?.sql && !stepsSchema.sql.includes('agent')) {
    db.exec(`
      CREATE TABLE steps_new (
        id          TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL CHECK(type IN ('code','llm','agent')),
        config      TEXT NOT NULL,
        transitions TEXT DEFAULT NULL
      );
      INSERT INTO steps_new SELECT * FROM steps;
      DROP TABLE steps;
      ALTER TABLE steps_new RENAME TO steps;
      CREATE INDEX IF NOT EXISTS idx_steps_workflow ON steps(workflow_id, position);
    `);
    console.log('[workflows-db] migrated steps table (added agent type)');
  }

  db.pragma('foreign_keys = ON');
  dbPool.set(agentId, db);
  return db;
}

// ── Row mappers ───────────────────────────────────────────────────────────

function rowToWorkflow(r: Record<string, unknown>): Workflow {
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    status: r.status as WorkflowStatus,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function rowToStep(r: Record<string, unknown>): Step {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    position: r.position as number,
    name: r.name as string,
    type: r.type as StepType,
    config: JSON.parse(r.config as string),
    transitions: r.transitions ? JSON.parse(r.transitions as string) : null,
  };
}

function rowToRun(r: Record<string, unknown>): Run {
  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    status: r.status as RunStatus,
    trigger: r.trigger as string,
    startedAt: r.started_at as number,
    finishedAt: (r.finished_at as number) ?? null,
  };
}

function rowToRunStep(r: Record<string, unknown>): RunStep {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    stepId: r.step_id as string,
    status: r.status as RunStepStatus,
    input: r.input ? JSON.parse(r.input as string) : null,
    output: r.output ? JSON.parse(r.output as string) : null,
    error: (r.error as string) ?? null,
    startedAt: (r.started_at as number) ?? null,
    finishedAt: (r.finished_at as number) ?? null,
    durationMs: (r.duration_ms as number) ?? null,
  };
}

// ── Workflow CRUD ─────────────────────────────────────────────────────────

function nextWorkflowId(db: Database.Database): string {
  const row = db.prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) + 1 AS next FROM workflows`).get() as { next: number };
  return `WF-${String(row.next).padStart(3, '0')}`;
}

export function listWorkflows(agentId: string): Workflow[] {
  const db = getDb(agentId);
  return (db.prepare(`SELECT * FROM workflows ORDER BY created_at DESC`).all() as Record<string, unknown>[]).map(rowToWorkflow);
}

export function getWorkflow(agentId: string, workflowId: string): WorkflowWithSteps | null {
  const db = getDb(agentId);
  const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(workflowId);
  if (!row) return null;
  const workflow = rowToWorkflow(row as Record<string, unknown>);
  const steps = (db.prepare(`SELECT * FROM steps WHERE workflow_id = ? ORDER BY position`).all(workflowId) as Record<string, unknown>[]).map(rowToStep);
  return { ...workflow, steps };
}

export function createWorkflow(agentId: string, data: { name: string; description?: string }): Workflow {
  const db = getDb(agentId);
  const id = nextWorkflowId(db);
  const now = Date.now();
  db.prepare(`
    INSERT INTO workflows (id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `).run(id, data.name, data.description ?? '', now, now);
  return getWorkflow(agentId, id)!;
}

export function updateWorkflow(agentId: string, workflowId: string, data: { name?: string; description?: string; status?: WorkflowStatus }): Workflow | null {
  const db = getDb(agentId);
  const existing = getWorkflow(agentId, workflowId);
  if (!existing) return null;
  const now = Date.now();
  db.prepare(`
    UPDATE workflows SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    data.status ?? existing.status,
    now,
    workflowId,
  );
  return getWorkflow(agentId, workflowId);
}

export function deleteWorkflow(agentId: string, workflowId: string): boolean {
  const db = getDb(agentId);
  const result = db.prepare(`DELETE FROM workflows WHERE id = ?`).run(workflowId);
  return result.changes > 0;
}

// ── Step CRUD ─────────────────────────────────────────────────────────────

export function addStep(agentId: string, workflowId: string, data: {
  name: string; type: StepType; config: Record<string, unknown>;
  transitions?: { conditions: { expr: string; goto: string }[] }; position?: number;
}): Step {
  const db = getDb(agentId);
  const id = randomUUID();
  const pos = data.position ?? (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next FROM steps WHERE workflow_id = ?`).get(workflowId) as { next: number }).next;
  db.prepare(`
    INSERT INTO steps (id, workflow_id, position, name, type, config, transitions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, workflowId, pos, data.name, data.type, JSON.stringify(data.config), data.transitions ? JSON.stringify(data.transitions) : null);
  // Update workflow timestamp
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), workflowId);
  return rowToStep(db.prepare(`SELECT * FROM steps WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function updateStep(agentId: string, stepId: string, data: {
  name?: string; type?: StepType; config?: Record<string, unknown>;
  transitions?: { conditions: { expr: string; goto: string }[] } | null; position?: number;
}): Step | null {
  const db = getDb(agentId);
  const existing = db.prepare(`SELECT * FROM steps WHERE id = ?`).get(stepId) as Record<string, unknown> | undefined;
  if (!existing) return null;
  const step = rowToStep(existing);
  db.prepare(`
    UPDATE steps SET name = ?, type = ?, config = ?, transitions = ?, position = ? WHERE id = ?
  `).run(
    data.name ?? step.name,
    data.type ?? step.type,
    data.config ? JSON.stringify(data.config) : existing.config as string,
    data.transitions !== undefined ? (data.transitions ? JSON.stringify(data.transitions) : null) : existing.transitions as string | null,
    data.position ?? step.position,
    stepId,
  );
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), step.workflowId);
  return rowToStep(db.prepare(`SELECT * FROM steps WHERE id = ?`).get(stepId) as Record<string, unknown>);
}

export function removeStep(agentId: string, stepId: string): boolean {
  const db = getDb(agentId);
  const step = db.prepare(`SELECT workflow_id FROM steps WHERE id = ?`).get(stepId) as { workflow_id: string } | undefined;
  if (!step) return false;
  db.prepare(`DELETE FROM steps WHERE id = ?`).run(stepId);
  db.prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).run(Date.now(), step.workflow_id);
  return true;
}

// ── Run management ────────────────────────────────────────────────────────

export function createRun(agentId: string, workflowId: string, trigger: string): Run {
  const db = getDb(agentId);
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO runs (id, workflow_id, status, trigger, started_at)
    VALUES (?, ?, 'running', ?, ?)
  `).run(id, workflowId, trigger, now);
  return rowToRun(db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function updateRun(agentId: string, runId: string, data: { status: RunStatus; finishedAt?: number }): void {
  const db = getDb(agentId);
  db.prepare(`UPDATE runs SET status = ?, finished_at = ? WHERE id = ?`).run(data.status, data.finishedAt ?? null, runId);
}

export function listRuns(agentId: string, workflowId: string): Run[] {
  const db = getDb(agentId);
  return (db.prepare(`SELECT * FROM runs WHERE workflow_id = ? ORDER BY started_at DESC`).all(workflowId) as Record<string, unknown>[]).map(rowToRun);
}

export function getRun(agentId: string, runId: string): RunWithSteps | null {
  const db = getDb(agentId);
  const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
  if (!row) return null;
  const run = rowToRun(row as Record<string, unknown>);
  const steps = (db.prepare(`
    SELECT rs.*, s.name as step_name, s.type as step_type, s.position as step_position
    FROM run_steps rs JOIN steps s ON rs.step_id = s.id
    WHERE rs.run_id = ? ORDER BY s.position
  `).all(runId) as Record<string, unknown>[]).map(rowToRunStep);
  return { ...run, steps };
}

// ── Run step management ───────────────────────────────────────────────────

export function createRunStep(agentId: string, data: { runId: string; stepId: string }): RunStep {
  const db = getDb(agentId);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO run_steps (id, run_id, step_id, status) VALUES (?, ?, ?, 'pending')
  `).run(id, data.runId, data.stepId);
  return rowToRunStep(db.prepare(`SELECT * FROM run_steps WHERE id = ?`).get(id) as Record<string, unknown>);
}

export function updateRunStep(agentId: string, runStepId: string, data: {
  status: RunStepStatus; input?: unknown; output?: unknown; error?: string;
  startedAt?: number; finishedAt?: number; durationMs?: number;
}): void {
  const db = getDb(agentId);
  db.prepare(`
    UPDATE run_steps SET status = ?, input = ?, output = ?, error = ?,
      started_at = ?, finished_at = ?, duration_ms = ?
    WHERE id = ?
  `).run(
    data.status,
    data.input !== undefined ? JSON.stringify(data.input) : null,
    data.output !== undefined ? JSON.stringify(data.output) : null,
    data.error ?? null,
    data.startedAt ?? null,
    data.finishedAt ?? null,
    data.durationMs ?? null,
    runStepId,
  );
}

// ── Monitor ──────────────────────────────────────────────────────────────

export function getRunningRuns(agentId: string): { runId: string; workflowId: string; workflowName: string; startedAt: number }[] {
  try {
    const db = getDb(agentId);
    return (db.prepare(`
      SELECT r.id as run_id, r.workflow_id, w.name as workflow_name, r.started_at
      FROM runs r JOIN workflows w ON r.workflow_id = w.id
      WHERE r.status = 'running'
      ORDER BY r.started_at DESC
    `).all() as { run_id: string; workflow_id: string; workflow_name: string; started_at: number }[]).map(r => ({
      runId: r.run_id,
      workflowId: r.workflow_id,
      workflowName: r.workflow_name,
      startedAt: r.started_at,
    }));
  } catch { return []; }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

export function closeWorkflowsDb(agentId: string): void {
  const db = dbPool.get(agentId);
  if (db) {
    db.close();
    dbPool.delete(agentId);
  }
}
