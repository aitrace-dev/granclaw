---
name: workflows
description: Create and manage automated workflows with code, LLM, and agent steps via the orchestrator REST API. Use when the user asks to automate a multi-step process.
user-invocable: false
allowed-tools: Bash(curl *)
---

# Workflow Manager Skill

You can create, edit, and trigger automated workflows that chain shell scripts, LLM calls, and full agent sessions into repeatable pipelines. Every operation goes through the **orchestrator REST API** — never touch SQLite directly.

## Connection

Two environment variables are injected into every agent process:

| Var | Value |
|---|---|
| `GRANCLAW_API_URL` | Base URL, e.g. `http://localhost:3001` (dev) or `http://localhost:8787` (published) |
| `GRANCLAW_AGENT_ID` | Your own agent ID, e.g. `lucia` |

All workflow endpoints are rooted at `$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows`.

**Sanity check before your first call:**
```bash
echo "API: $GRANCLAW_API_URL  Agent: $GRANCLAW_AGENT_ID"
curl -sf "$GRANCLAW_API_URL/health" && echo " — orchestrator reachable"
```

## Object model

A **workflow** is a named, ordered list of **steps**. Each step is one of three types:

- **`code`** — a shell script the runner executes in your workspace
- **`llm`** — a structured Claude call returning JSON
- **`agent`** — a full Claude session with all your tools (browser, bash, vault, etc.)

Steps execute in order by `position`, unless a step defines **transitions** that redirect flow based on its output. A **run** is one execution of a workflow; the runner records a **run_step** row for each step executed in that run.

### Workflow fields (JSON shape from the API)

| Field | Type | Notes |
|---|---|---|
| `id` | string | `WF-NNN`, **auto-assigned by the server** on create. You never pick it. |
| `name` | string | Human-readable name, keep concise. |
| `description` | string | What the workflow does. Markdown supported. |
| `status` | string | `active`, `paused`, or `archived`. |
| `createdAt` | number | Unix ms. |
| `updatedAt` | number | Unix ms. |
| `steps` | array | Present on `GET /workflows/:wfId` — the ordered list of step objects. |

### Step fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID, **auto-assigned by the server** on create. |
| `workflowId` | string | Parent workflow. |
| `position` | number | 0-indexed execution order. |
| `name` | string | Human-readable step name (shows in dashboard). |
| `type` | string | `code`, `llm`, or `agent`. |
| `config` | object | JSON shape depends on type — see below. |
| `transitions` | object \| null | Optional branching rules — see below. |

### Run and run_step (read-only)

The runner creates `run` and `run_step` records when a workflow executes. You fetch them via `GET /workflows/:wfId/runs` — **you never create or modify them.**

## Step config shapes

### Code step

```json
{
  "script": "curl -s https://api.example.com/data | jq '.items[:5]'",
  "shell": "bash",
  "timeout_ms": 30000
}
```

The script runs in your workspace directory with your `.env` vars loaded. Output should be valid JSON when possible — the runner parses stdout as JSON, falling back to raw string.

### LLM step

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

Templates in prompts:
- `{{prev.output}}` — JSON output of the previous step
- `{{steps.<step-name>.output}}` — JSON output of any earlier step referenced by name

Always include clear "return JSON with schema X" instructions in the prompt.

### Agent step

A full Claude session with all your tools. Use when a task needs multiple tool calls, iterative work, or any non-deterministic reasoning.

```json
{
  "prompt": "Research the latest AI news. Browse LinkedIn and tech sites. Save a summary of the top 5 findings to vault/journal/today/research.md",
  "timeout_ms": 300000
}
```

Templates are the same as LLM steps (`{{prev.output}}`, `{{steps.<name>.output}}`).

**When to pick which step type:**
- `code` — deterministic scripts (curl, jq, data transforms)
- `llm` — one-shot structured text transformation
- `agent` — anything that needs the full tool set (browsing, writing files, iterating)

**Signaling failure from an agent step:** return text starting with `FAILED:` followed by the reason. Example: `FAILED: LinkedIn auth expired, cannot browse posts`. The runner marks the step failed and stops the workflow. You can also add `"fail_if": "<regex>"` to the step config for automatic failure detection.

## Transitions

```json
{
  "conditions": [
    { "expr": "output.proceed === true", "goto": "<step-uuid>" },
    { "expr": "output.proceed === false", "goto": "END" }
  ]
}
```

- `expr` is a JS expression evaluated against the step's output (`output` is the variable name)
- `goto` is a target step UUID or the literal `"END"` to stop the workflow
- If no condition matches, the runner proceeds to `position + 1`
- If `transitions` is absent/null, the runner always proceeds linearly

## Operations

### List workflows

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows"
```

Returns an array of workflow summaries.

### Get a workflow with its steps

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001"
```

### Create a workflow

```bash
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"LinkedIn Scout","description":"Scrape and analyze LinkedIn posts"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows"
```

Returns the new workflow with its auto-assigned `WF-NNN` id. Save that id — you need it for every subsequent call.

### Update a workflow

```bash
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d '{"status":"paused"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001"
```

Send only the fields you want to change.

### Delete a workflow

```bash
curl -sf -X DELETE "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001"
```

Steps, runs, and run_steps cascade.

### Add a step to a workflow

```bash
# Step 0 — code: fetch posts
cat > /tmp/step.json <<'EOF'
{
  "name": "Scrape posts",
  "type": "code",
  "position": 0,
  "config": {
    "script": "curl -s https://api.example.com/posts | jq '.[:5]'",
    "timeout_ms": 15000
  }
}
EOF
curl -sf -X POST \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/step.json \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/steps"
rm /tmp/step.json
```

The server assigns the step UUID. `position` is optional — if omitted, the step appends to the end.

### Update a step

```bash
curl -sf -X PUT \
  -H "Content-Type: application/json" \
  -d '{"config":{"script":"echo new","timeout_ms":5000}}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/steps/<step-uuid>"
```

### Remove a step

```bash
curl -sf -X DELETE "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/steps/<step-uuid>"
```

### Trigger a workflow run

```bash
curl -sf -X POST \
  -H "Content-Type: application/json" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/run"
```

Returns `{"runId":"..."}` immediately; the run executes asynchronously on the orchestrator.

### List runs for a workflow

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/runs"
```

Newest first. Each entry includes `status` (`running`, `completed`, `failed`, `cancelled`), `trigger`, `startedAt`, `finishedAt`.

### Get a single run with step details

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/runs/<run-id>"
```

Returns the run plus its `steps` (or `runSteps`) array — each with `status`, `input`, `output`, `error`, `durationMs`. Use this to debug failed runs.

## End-to-end example: create and run a three-step workflow

```bash
# 1. Create the workflow, capture the WF-NNN id
WF=$(curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d '{"name":"Scout","description":"Scrape → analyze → build"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows" \
  | jq -r '.id')
echo "Created $WF"

# 2. Add step 0 — code
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Scrape posts\",\"type\":\"code\",\"position\":0,\"config\":{\"script\":\"curl -s https://api.example.com/posts | jq '.[:5]'\",\"timeout_ms\":15000}}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/steps"

# 3. Add step 1 — llm with a branch to END if not worthy
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Analyze engagement\",\"type\":\"llm\",\"position\":1,\"config\":{\"prompt\":\"Analyze these posts:\n\n{{prev.output}}\n\nReturn JSON: {\\\"worthy\\\": true/false, \\\"reason\\\": \\\"...\\\"}\",\"output_schema\":{\"worthy\":\"boolean\",\"reason\":\"string\"}},\"transitions\":{\"conditions\":[{\"expr\":\"output.worthy === false\",\"goto\":\"END\"}]}}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/steps"

# 4. Add step 2 — code (only reached if worthy)
curl -sf -X POST \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Build prototype\",\"type\":\"code\",\"position\":2,\"config\":{\"script\":\"echo 'building...' && mkdir -p output && echo '{\\\"status\\\":\\\"built\\\"}' > output/result.json\",\"timeout_ms\":60000}}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/steps"

# 5. Trigger a run
RUN=$(curl -sf -X POST "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/run" | jq -r '.runId')
echo "Run started: $RUN"

# 6. Poll for completion
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/runs/$RUN"
```

**Tip:** keep complex payloads in temp files and use `--data-binary @file` when the JSON gets unreadable inline. The example above shows both styles.

## Best practices

1. **Keep code steps small.** Each should do one thing. Chain steps instead of writing megascripts.
2. **Use structured output.** Always instruct LLM steps to return JSON with a clear schema.
3. **Name steps descriptively.** Step names appear in the dashboard.
4. **Test scripts first.** Run your shell script manually before wrapping it as a code step.
5. **Use transitions for branching.** Don't embed conditional logic in a script — use the runner's transition system so the dashboard can visualize the flow.
6. **Parse JSON responses with `jq` when capturing IDs.** See the end-to-end example — capturing `WF` from the create response is the ergonomic way to chain calls.
7. **Check run status before claiming success.** Trigger a run, then `GET /runs/:runId` to confirm it completed without error. A 201 from `/run` only means the run was queued, not that it succeeded.

## Error handling

- **Empty env vars** — if `$GRANCLAW_API_URL` or `$GRANCLAW_AGENT_ID` is unset, the orchestrator isn't exposing them; report and stop.
- **`curl: (7) Failed to connect`** — orchestrator is down or on a different port. Don't guess.
- **`404 Not Found`** — the workflow, step, or run id doesn't exist. List first to confirm.
- **`400 Bad Request`** — usually a missing required field. Workflows need `name`. Steps need `name`, `type`, `config`. Step updates reject unknown types.
- **Agent step hangs** — raise its `timeout_ms`. The default is generous but not infinite.

## Prohibited operations

**NEVER do any of these:**

- Open or write to `workflows.sqlite` (or any `.sqlite` file) directly. The database is the orchestrator's implementation detail; you only ever talk to it through REST.
- `INSERT` / `UPDATE` / `DELETE` on `runs` or `run_steps` tables. Those are the runner's territory.
- Call the old hardcoded `http://localhost:3001/agents/main-agent/...` URL. Use `$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/...` so the skill works for every agent on every port.
- Generate `WF-NNN` ids or step UUIDs yourself. The server picks them on create.

## Why this uses the REST API, not SQLite

Earlier versions of this skill ran `sqlite3` directly against `workflows.sqlite`. That bypassed the orchestrator, which broke live dashboard updates, skipped validation, and made it impossible for multiple processes (agent, workflow runner, dashboard) to coordinate safely on the same database. The orchestrator is now the single writer: it owns mutation, fires dashboard updates, and manages the lifecycle of runs. Treat the REST API as the contract; SQLite is an implementation detail you never touch.
