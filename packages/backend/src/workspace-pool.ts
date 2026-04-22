/**
 * workspace-pool.ts
 *
 * Per-workspace DB pool. Each agent workspace gets one `agent.sqlite` file
 * containing all per-agent tables: sessions, jobs, tasks, comments,
 * workflows, steps, runs, run_steps, schedules.
 *
 * All schema creation lives here — individual DB modules no longer open
 * their own connections; they call getWorkspaceDb(workspaceDir) instead.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const pool = new Map<string, Database.Database>();

export function getWorkspaceDb(workspaceDir: string): Database.Database {
  const cached = pool.get(workspaceDir);
  if (cached) return cached;

  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

  const db = new Database(path.join(workspaceDir, 'agent.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── sessions + jobs (from agent-db) ───────────────────────────────────────
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

  // Migration: add session_file column if missing (existing agent.db compat)
  const sessionCols = (db.pragma('table_info(sessions)') as Array<{ name: string }>).map(c => c.name);
  if (!sessionCols.includes('session_file')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN session_file TEXT`);
  }

  // ── tasks + comments (from tasks-db) ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'backlog'
                    CHECK(status IN ('backlog','in_progress','scheduled','to_review','done','cancelled')),
      source      TEXT NOT NULL DEFAULT 'agent'
                    CHECK(source IN ('agent','human')),
      updated_by  TEXT DEFAULT NULL
                    CHECK(updated_by IN ('agent','human')),
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      source     TEXT NOT NULL CHECK(source IN ('agent','human')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);
  `);

  // ── workflows + steps + runs + run_steps (from workflows-db) ─────────────
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

  // Migration: ensure tasks.status allows 'cancelled' (added 2026-04-22).
  // SQLite CHECK constraints are baked into the table at CREATE time and
  // cannot be altered, so rebuild the table when the constraint is stale.
  const tasksSchema = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'`
  ).get() as { sql: string } | undefined);
  if (tasksSchema?.sql && !tasksSchema.sql.includes('cancelled')) {
    db.exec(`
      CREATE TABLE tasks_new (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'backlog'
                      CHECK(status IN ('backlog','in_progress','scheduled','to_review','done','cancelled')),
        source      TEXT NOT NULL DEFAULT 'agent'
                      CHECK(source IN ('agent','human')),
        updated_by  TEXT DEFAULT NULL
                      CHECK(updated_by IN ('agent','human')),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      INSERT INTO tasks_new SELECT * FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    `);
    console.log('[workspace-pool] migrated tasks table (added cancelled status)');
  }

  // Migration: ensure steps.type allows 'agent' (existing workflows.sqlite compat)
  const stepsSchema = (db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='steps'`
  ).get() as { sql: string } | undefined);
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
    console.log('[workspace-pool] migrated steps table (added agent type)');
  }

  // ── secrets ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      name        TEXT NOT NULL PRIMARY KEY,
      value       TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // ── schedules (from schedules-db) ─────────────────────────────────────────
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

    CREATE TABLE IF NOT EXISTS schedule_runs (
      id          TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      agent_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      started_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule
      ON schedule_runs (schedule_id, started_at DESC);
  `);

  pool.set(workspaceDir, db);
  return db;
}

/** Close and evict a workspace DB from the pool. Safe to call multiple times. */
export function closeWorkspaceDb(workspaceDir: string): void {
  const db = pool.get(workspaceDir);
  if (db) {
    db.close();
    pool.delete(workspaceDir);
  }
}
