---
name: workflows
description: Create and manage automated workflows with code and LLM steps. Use when the user asks to automate a multi-step process.
user-invocable: false
allowed-tools: Bash(sqlite3 *)
---

# Workflow Manager Skill

You have a SQLite database at `workflows.sqlite` in your workspace root. Use it to create automated workflows that combine shell scripts and LLM calls into repeatable, multi-step processes.

## Schema Reference

The database is **pre-provisioned by the host**. Never run CREATE TABLE, ALTER TABLE, or DROP TABLE.

### workflows table

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Auto-format: `WF-NNN` (e.g. `WF-001`). Zero-padded to 3 digits. |
| `name` | TEXT | NOT NULL | Human-readable name. Keep concise. |
| `description` | TEXT | DEFAULT '' | What the workflow does. Markdown supported. |
| `status` | TEXT | DEFAULT 'active' | One of: `active`, `paused`, `archived`. |
| `created_at` | INTEGER | NOT NULL | Unix ms. Use `CAST(strftime('%s','now') AS INTEGER) * 1000`. |
| `updated_at` | INTEGER | NOT NULL | Unix ms. Update on every modification. |

### steps table

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | UUID. Generate with `lower(hex(randomblob(16)))`. |
| `workflow_id` | TEXT | FK → workflows(id) CASCADE | Parent workflow. |
| `position` | INTEGER | NOT NULL | Execution order (0-indexed). |
| `name` | TEXT | NOT NULL | Human-readable step name. |
| `type` | TEXT | NOT NULL | `code` or `llm`. |
| `config` | TEXT | NOT NULL | JSON config (see below). |
| `transitions` | TEXT | DEFAULT NULL | JSON transition rules (see below). |

### runs table (read-only)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID. Created by the runner. |
| `workflow_id` | TEXT FK | Parent workflow. |
| `status` | TEXT | `running`, `completed`, `failed`, `cancelled`. |
| `trigger` | TEXT | `manual` or `chat`. |
| `started_at` | INTEGER | Unix ms. |
| `finished_at` | INTEGER | Unix ms (NULL while running). |

### run_steps table (read-only)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID. |
| `run_id` | TEXT FK | Parent run. |
| `step_id` | TEXT FK | Which step. |
| `status` | TEXT | `pending`, `running`, `completed`, `failed`, `skipped`. |
| `input` | TEXT | JSON input fed to this step. |
| `output` | TEXT | JSON output produced. |
| `error` | TEXT | Error message if failed. |
| `duration_ms` | INTEGER | Execution time. |

## Step Config

### Code steps

```json
{
  "script": "curl -s https://api.example.com/data | jq '.items[:5]'",
  "shell": "bash",
  "timeout_ms": 30000
}
```

The script runs in your workspace directory. It has access to your `.env` vars. Output should be valid JSON when possible — the runner will try to parse stdout as JSON, falling back to raw string.

### LLM steps

```json
{
  "prompt": "Analyze this data and decide if we should proceed:\n\n{{prev.output}}\n\nRespond with JSON: {\"proceed\": true/false, \"reason\": \"...\"}",
  "model": "claude-sonnet-4-5",
  "output_schema": {
    "proceed": "boolean",
    "reason": "string"
  }
}
```

Templates available in prompts:
- `{{prev.output}}` — JSON output of the previous step
- `{{steps.<step-name>.output}}` — JSON output of any earlier step by name

The LLM is instructed to return structured JSON. Always include clear format instructions in your prompt.

### Agent steps

Agent steps run a full Claude session with all your tools (browser, bash, vault, Telegram).
Unlike LLM steps, agent steps can make multiple tool calls, browse the web, and iterate
autonomously until the task is complete.

```json
{
  "prompt": "Research the latest AI news. Browse LinkedIn and tech news sites. Save a summary of the top 5 findings to vault/journal/today/research.md",
  "timeout_ms": 300000
}
```

Templates available in prompts:
- `{{prev.output}}` — previous step's output
- `{{steps.<step-name>.output}}` — any earlier step's output by name

**When to use agent steps:**
- Tasks requiring multiple tool calls (browsing, file operations, API calls)
- Iterative work (research → analyze → decide → act)
- Anything that needs your full tool set

**When to use LLM steps instead:**
- Simple text generation or analysis with no tool access needed
- Structured JSON output from a single prompt

**When to use code steps instead:**
- Deterministic scripts (curl, jq, data transforms)
- Fast operations that don't need AI reasoning

**Signaling failure from an agent step:**
If you cannot complete the task, include `FAILED:` followed by the reason in your response.
This will mark the step as failed and stop the workflow (remaining steps are skipped).

Example: `FAILED: LinkedIn auth expired, cannot browse posts`

You can also add `"fail_if": "<regex>"` to the step config to auto-detect failure patterns in output.

## Transitions

```json
{
  "conditions": [
    { "expr": "output.proceed === true", "goto": "<step-uuid>" },
    { "expr": "output.proceed === false", "goto": "END" }
  ]
}
```

- Conditions are JS expressions evaluated against the step's output.
- `goto` is a step UUID or `"END"` to stop the workflow.
- If no condition matches, the runner proceeds to the next step by position.
- If no transitions are defined, the runner always goes to position + 1.

## Operations

### Generate next workflow ID

```sql
SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 0) + 1 FROM workflows;
```

Format as `WF-` followed by zero-padded 3-digit number.

### Create a workflow with steps

```sql
-- 1. Create the workflow
INSERT INTO workflows (id, name, description, status, created_at, updated_at)
VALUES ('WF-001', 'LinkedIn Scout', 'Scrape and analyze LinkedIn posts', 'active',
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000);

-- 2. Add steps in order
INSERT INTO steps (id, workflow_id, position, name, type, config, transitions)
VALUES (
  lower(hex(randomblob(16))), 'WF-001', 0, 'Scrape posts', 'code',
  '{"script": "curl -s https://api.example.com/posts | jq ''.[:5]''", "timeout_ms": 15000}',
  NULL
);

INSERT INTO steps (id, workflow_id, position, name, type, config, transitions)
VALUES (
  lower(hex(randomblob(16))), 'WF-001', 1, 'Analyze engagement', 'llm',
  '{"prompt": "Analyze these posts:\\n\\n{{prev.output}}\\n\\nOutput JSON: {\"worthy\": true/false, \"reason\": \"...\"}", "output_schema": {"worthy": "boolean", "reason": "string"}}',
  '{"conditions": [{"expr": "output.worthy === false", "goto": "END"}]}'
);

INSERT INTO steps (id, workflow_id, position, name, type, config, transitions)
VALUES (
  lower(hex(randomblob(16))), 'WF-001', 2, 'Build prototype', 'code',
  '{"script": "echo ''Building prototype...'' && mkdir -p output && echo ''{\"status\": \"built\"}'' > output/result.json && cat output/result.json", "timeout_ms": 60000}',
  NULL
);
```

### Trigger a workflow run

```bash
curl -X POST http://localhost:3001/agents/main-agent/workflows/WF-001/run
```

### Check run results

```sql
SELECT rs.status, s.name, rs.output, rs.error, rs.duration_ms
FROM run_steps rs JOIN steps s ON rs.step_id = s.id
JOIN runs r ON rs.run_id = r.id
WHERE r.workflow_id = 'WF-001'
ORDER BY r.started_at DESC, s.position
LIMIT 20;
```

## Best Practices

1. **Keep scripts small.** Each code step should do one thing. Chain steps instead of writing complex scripts.
2. **Use structured output.** Always instruct LLM steps to return JSON with a clear schema.
3. **Name steps clearly.** Step names appear in the UI — make them descriptive.
4. **Test scripts first.** Run your script manually before adding it as a workflow step.
5. **Use transitions for branching.** Don't embed conditional logic in scripts — use the workflow's transition system.
6. **One command at a time.** Run each sqlite3 command separately to verify results.

## Prohibited Operations

**NEVER run:**
- `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE` — schema is pre-provisioned
- `PRAGMA` — managed by the host
- `INSERT/UPDATE/DELETE` on `runs` or `run_steps` — these are managed by the workflow runner
