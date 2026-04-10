---
name: task-board
description: Manage tasks in the kanban board via the orchestrator REST API. Use when breaking down work, tracking progress, or reporting status.
user-invocable: false
allowed-tools: [bash]
---

# Task Manager Skill

You have a kanban board your human operator can see in the dashboard. Create, update, and comment on tasks by calling the **orchestrator REST API** — never touch SQLite directly.

## Connection

The orchestrator exposes a local HTTP API. Two environment variables are injected into every agent process:

| Var | Value |
|---|---|
| `GRANCLAW_API_URL` | Base URL, e.g. `http://localhost:3001` (dev) or `http://localhost:8787` (published) |
| `GRANCLAW_AGENT_ID` | Your own agent ID, e.g. `lucia` |

All task endpoints are rooted at `$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks`.

**Sanity check before your first call:**
```bash
echo "API: $GRANCLAW_API_URL  Agent: $GRANCLAW_AGENT_ID"
curl -sf "$GRANCLAW_API_URL/health" && echo " — orchestrator reachable"
```

## Task shape

Every task has these JSON fields (camelCase — this is what the API returns and accepts):

| Field | Type | Notes |
|---|---|---|
| `id` | string | `TSK-NNN` format, **auto-assigned by the server** on create. You never pick the ID. |
| `title` | string | Short, under 80 characters. |
| `description` | string | Full description in **markdown**. Use headings, lists, code blocks. |
| `status` | string | One of: `backlog`, `in_progress`, `scheduled`, `to_review`, `done`. |
| `source` | string | Who created it — `agent` for tasks you create, `human` for tasks the user created in the dashboard. |
| `updatedBy` | string \| null | Who last modified it. If it's `human`, the user edited since you last saw it. |
| `createdAt` | number | Unix seconds. |
| `updatedAt` | number | Unix seconds. |

## Status lifecycle

| Status | When to use |
|---|---|
| `backlog` | Identified but not started. Use when breaking down a larger request into subtasks. |
| `in_progress` | Actively working on it. Only one or two tasks should be `in_progress` at a time. |
| `scheduled` | Planned for future work. |
| `to_review` | Work complete, awaiting human review. Move tasks here when you finish and want feedback. |
| `done` | Fully completed and verified. |

**Typical flow:** `backlog` → `in_progress` → `to_review` → `done`
**Deferred work:** `backlog` → `scheduled` → `in_progress` → `to_review` → `done`

## Operations

### List all tasks

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks"
```

Returns a JSON array sorted by creation time.

### List tasks by status

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks?status=in_progress"
```

### Get a single task (includes its comments)

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks/TSK-001"
```

Response has the usual task fields **plus** a `comments` array of `{id, taskId, body, source, createdAt}`.

### Create a task

```bash
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"title":"Implement login page","description":"## Requirements\n- Email/password form\n- Validation\n- Error messages","status":"backlog"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks"
```

Returns the newly created task (including its auto-assigned `TSK-NNN` id). `status` defaults to `backlog` if omitted; `description` defaults to `""`.

**Tip:** Write multi-line descriptions to a temp file and use `--data-binary @file` when the markdown gets complex:

```bash
cat > /tmp/desc.json <<'EOF'
{
  "title": "Implement login page",
  "description": "## Requirements\n\n- Email/password form\n- Validation\n- Error messages\n\n## Notes\n\nSee the design doc.",
  "status": "backlog"
}
EOF
curl -sf -X POST \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/desc.json \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks"
rm /tmp/desc.json
```

### Update a task

Send only the fields you want to change:

```bash
# Move to in_progress
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks/TSK-001"

# Update title and description
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d '{"title":"New title","description":"New markdown body"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks/TSK-001"
```

### Delete a task

```bash
curl -sf -X DELETE "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks/TSK-001"
```

Comments are deleted automatically via cascade.

### Add a comment

```bash
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"body":"Started working on the form layout. Using flexbox for responsive design."}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks/TSK-001/comments"
```

### List comments for a task

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks/TSK-001/comments"
```

(Or just `GET /tasks/TSK-001` — it already embeds comments.)

## Attribution rules

- The server stamps `source: "agent"` on every task and comment you create, and sets `updatedBy: "agent"` on every update. You don't need to send these fields.
- If a task's `source` or `updatedBy` is `"human"`, the human created or edited it. Check what changed before making further updates.
- If a comment's `source` is `"human"`, read it carefully — it may contain feedback or instructions for you.

## Best practices

1. **Break down work.** When given a large request, create multiple tasks in `backlog` before starting.
2. **Update status promptly.** Move tasks to `in_progress` when you start and `to_review` when you finish.
3. **Use `to_review` generously.** When you complete something the human should verify, move it to `to_review` and add a comment explaining what was done.
4. **Check for human edits.** Before bulk-updating, list tasks and look for `updatedBy: "human"` to see if the user reorganized anything.
5. **Use markdown in descriptions and comments.** Code blocks, links, and lists make your updates clear.
6. **Parse JSON with `jq` if needed.** Agents that have `jq` on PATH can pipe responses through it:
   ```bash
   curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/tasks" | jq -r '.[] | "\(.id) [\(.status)] \(.title)"'
   ```

## Error handling

- **Empty env vars:** if `$GRANCLAW_API_URL` or `$GRANCLAW_AGENT_ID` is empty, the orchestrator isn't exposing them — report the problem to the human and stop.
- **`curl: (7) Failed to connect`:** orchestrator is down or on a different port. Don't guess — report it.
- **`404 Not Found`:** task ID doesn't exist. List tasks first to confirm.
- **`400 Bad Request`:** usually a missing required field (title for tasks, body for comments). Check your JSON payload.
- **Non-zero exit from curl:** `-sf` makes curl fail hard on HTTP errors. If that's inconvenient, drop the `-f` and parse the response status yourself.

## Why this uses the REST API, not SQLite

Earlier versions of this skill read and wrote `tasks.sqlite` directly in your workspace. That worked but bypassed the orchestrator, so:
- Real-time dashboard updates didn't fire (the UI polls via REST/WS, not SQLite file watches)
- Validation and cascade rules enforced by the API layer were skipped
- Workspace-specific DB paths made cross-agent coordination impossible

Now the orchestrator is the single source of truth. Treat the API as the contract; SQLite is an implementation detail you should never touch from here.
