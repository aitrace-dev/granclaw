---
name: task-board
description: Manage tasks in the kanban board via SQLite. Use when breaking down work, tracking progress, or reporting status.
user-invocable: false
allowed-tools: Bash(sqlite3 *)
---

# Task Manager Skill

You have a SQLite database at `tasks.sqlite` in your workspace root. Use it to track tasks on a kanban board that your human operator can see in the dashboard.

## Schema Reference

The database is **pre-provisioned by the host**. Never run CREATE TABLE, ALTER TABLE, or DROP TABLE. The schema is immutable.

### tasks table

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Human-readable ID in format `TSK-NNN` (e.g. `TSK-001`, `TSK-042`). Zero-padded to 3 digits. |
| `title` | TEXT | NOT NULL | Short, descriptive task title. Keep under 80 characters. |
| `description` | TEXT | NOT NULL, DEFAULT '' | Full task description in **markdown**. Use headings, lists, code blocks as needed. |
| `status` | TEXT | NOT NULL, DEFAULT 'backlog' | Current status. Must be one of: `backlog`, `in_progress`, `scheduled`, `to_review`, `done`. |
| `source` | TEXT | NOT NULL, DEFAULT 'agent' | Who created the task. Always set to `'agent'` when you create tasks. |
| `updated_by` | TEXT | DEFAULT NULL | Who last modified the task. Always set to `'agent'` when you update tasks. If this is `'human'`, the human edited it since you last saw it. |
| `created_at` | INTEGER | NOT NULL | Unix timestamp in seconds. Use `strftime('%s', 'now')` in SQLite. |
| `updated_at` | INTEGER | NOT NULL | Unix timestamp in seconds. Must be updated on every modification. |

### comments table

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID string. Generate with `lower(hex(randomblob(16)))` in SQLite. |
| `task_id` | TEXT | NOT NULL, FK → tasks(id) ON DELETE CASCADE | The task this comment belongs to. |
| `body` | TEXT | NOT NULL | Comment content in **markdown**. |
| `source` | TEXT | NOT NULL | Who wrote the comment. Always `'agent'` when you add comments. |
| `created_at` | INTEGER | NOT NULL | Unix timestamp in seconds. |

### Indexes

- `idx_tasks_status` on `tasks(status)`
- `idx_comments_task` on `comments(task_id, created_at)`

## Status Lifecycle

Use these statuses to communicate progress to your human operator:

| Status | When to use |
|---|---|
| `backlog` | Task identified but work has not started. Use when breaking down a larger request into subtasks. |
| `in_progress` | You are actively working on this task right now. Only one or two tasks should be `in_progress` at a time. |
| `scheduled` | You plan to work on this task but not immediately. Use when you've identified future work. |
| `to_review` | Work is complete and you want the human to review it. Move tasks here when you finish implementation and want feedback. |
| `done` | Task is fully completed and verified. Move here after human confirms the work is acceptable, or for tasks that need no review. |

**Typical flow:** `backlog` → `in_progress` → `to_review` → `done`

**Deferred work:** `backlog` → `scheduled` → `in_progress` → `to_review` → `done`

## Operations

### Generate next task ID

Before creating a task, query for the next available ID:

```sql
SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) + 1 FROM tasks;
```

Then format as `TSK-` followed by zero-padded 3-digit number. Example: result is 7 → ID is `TSK-007`.

### Create a task

```sql
INSERT INTO tasks (id, title, description, status, source, updated_by, created_at, updated_at)
VALUES (
  'TSK-001',
  'Implement login page',
  '## Requirements\n- Email/password form\n- Validation\n- Error messages',
  'backlog',
  'agent',
  NULL,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);
```

### Update task status

```sql
UPDATE tasks
SET status = 'in_progress', updated_by = 'agent', updated_at = strftime('%s', 'now')
WHERE id = 'TSK-001';
```

### Update task title or description

```sql
UPDATE tasks
SET title = 'New title', description = 'New description', updated_by = 'agent', updated_at = strftime('%s', 'now')
WHERE id = 'TSK-001';
```

### List all tasks

```sql
SELECT id, title, status, source, updated_by, created_at, updated_at FROM tasks ORDER BY created_at;
```

### List tasks by status

```sql
SELECT id, title, description, source, updated_by, created_at, updated_at
FROM tasks WHERE status = 'in_progress' ORDER BY updated_at DESC;
```

### Get a single task with details

```sql
SELECT * FROM tasks WHERE id = 'TSK-001';
```

### Delete a task

```sql
DELETE FROM tasks WHERE id = 'TSK-001';
```

Comments are deleted automatically via CASCADE.

### Add a comment

```sql
INSERT INTO comments (id, task_id, body, source, created_at)
VALUES (
  lower(hex(randomblob(16))),
  'TSK-001',
  'Started working on the form layout. Using flexbox for responsive design.',
  'agent',
  strftime('%s', 'now')
);
```

### List comments for a task

```sql
SELECT id, body, source, created_at FROM comments WHERE task_id = 'TSK-001' ORDER BY created_at ASC;
```

## Attribution Rules

- **Always** set `source = 'agent'` when creating tasks or comments.
- **Always** set `updated_by = 'agent'` when updating tasks.
- If you see `updated_by = 'human'` on a task, the human changed it since your last interaction. Check what changed before making further updates.
- If you see a comment with `source = 'human'`, read it carefully — it may contain feedback or instructions.

## Best Practices

1. **Break down work.** When given a large request, create multiple tasks in `backlog` before starting.
2. **Update status promptly.** Move tasks to `in_progress` when you start, `to_review` when you finish.
3. **Use `to_review` generously.** When you complete something the human should verify, move it to `to_review` and add a comment explaining what was done.
4. **Check for human edits.** Before bulk-updating tasks, query for tasks where `updated_by = 'human'` to see if the human reorganized anything.
5. **Use markdown in descriptions and comments.** Include code blocks, links, and lists to make your updates clear and structured.
6. **One command at a time.** Run each sqlite3 command separately so you can verify the result.

## Prohibited Operations

**NEVER run any of these:**
- `CREATE TABLE` — schema is pre-provisioned
- `ALTER TABLE` — schema is immutable
- `DROP TABLE` — destructive and irreversible
- `PRAGMA` — database configuration is managed by the host
- `.schema` — not needed, schema is documented above

The database file `tasks.sqlite` is managed by the host system. You are a client — read and write data only.
