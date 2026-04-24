---
name: workflows
description: Create and manage automated DAG workflows with agent nodes, foreach loops, conditionals, and merges via the orchestrator REST API. Use when the user asks to automate a multi-step process.
user-invocable: false
allowed-tools: [bash]
---

# Workflow Manager Skill

You can create, edit, and trigger automated **graph workflows** (directed acyclic graphs) that chain agent steps, loops, branches, and merges into repeatable pipelines. Every operation goes through the **orchestrator REST API** — never touch SQLite directly.

## Connection

Two environment variables are injected into every agent process:

| Var | Value |
|---|---|
| `GRANCLAW_API_URL` | Base URL, e.g. `http://localhost:3001` (dev) or `http://localhost:8787` (published) |
| `GRANCLAW_AGENT_ID` | Your own agent ID, e.g. `lucia` |

All endpoints are rooted at `$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows`.

```bash
echo "API: $GRANCLAW_API_URL  Agent: $GRANCLAW_AGENT_ID"
curl -sf "$GRANCLAW_API_URL/health" && echo " — orchestrator reachable"
```

## Concepts

A **workflow** is a DAG of **nodes** connected by **edges**. When triggered, the runner executes nodes in topological order — each node runs only after all its incoming edges are resolved.

### Node types

| Type | Purpose | Config |
|---|---|---|
| `trigger` | Entry point. Every workflow needs exactly one. | `{}` |
| `agent` | Runs a full agent session with tools (browser, bash, vault, etc.) | `{ prompt, timeout_ms }` |
| `foreach` | Iterates over an array from upstream, running the body subgraph once per item | `{ expression }` — defaults to `input` (the whole upstream output) |
| `conditional` | Agent-based routing — evaluates input and picks a branch | `{ prompt, handles, timeout_ms }` |
| `merge` | Waits for all incoming edges, combines their outputs | `{}` |
| `end` | Terminal node. Marks the workflow as complete. | `{}` |

### Edges

An edge connects a source node to a target node. Each edge has:
- `sourceId` — the node it comes from
- `targetId` — the node it goes to
- `sourceHandle` — which output port (`default`, `body`, `done`, `true`, `false`, etc.)
- `condition` — optional label for conditional routing

ForEach nodes have two output handles: `body` (runs per item) and `done` (fires after all iterations with the collected results array).

Conditional nodes have handles matching their `handles` config (e.g. `true`, `false`, or custom names).

All other nodes use `default`.

### Agent node prompts

When an agent node runs, the runner automatically:
1. Injects workflow context (previous step outputs, iteration data)
2. Registers a `workflow_step_complete` tool — the agent calls this when done

**You do NOT need to mention `workflow_step_complete` in the prompt.** The runner handles it.

If downstream nodes expect structured data (e.g. a JSON array for a ForEach), instruct the agent to return that format:

```
Search for 10 AI news articles. Return a JSON array of objects with keys: title, summary, url, date.
```

The agent will call `workflow_step_complete` with the output automatically.

## API Reference

### Workflow CRUD

```bash
# List all workflows
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows"

# Create a workflow
curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"name":"My Workflow","description":"Does X then Y"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows"
# Returns { id: "WF-001", ... } — save the id

# Get a workflow
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001"

# Update a workflow
curl -sf -X PUT -H "Content-Type: application/json" \
  -d '{"status":"paused"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001"

# Delete a workflow
curl -sf -X DELETE "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001"
```

### Graph — full save (replace all nodes and edges at once)

```bash
# Get the current graph
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/graph"

# Save entire graph (replaces all nodes and edges)
curl -sf -X PUT -H "Content-Type: application/json" \
  -d '{"nodes":[...],"edges":[...]}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/graph"
```

### Nodes — individual CRUD

```bash
# Add a node
curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"nodeType":"agent","name":"Fetch Data","config":{"prompt":"...","timeout_ms":120000}}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/nodes"
# Returns the node with auto-assigned UUID id

# Update a node
curl -sf -X PUT -H "Content-Type: application/json" \
  -d '{"name":"New Name","config":{"prompt":"updated prompt","timeout_ms":60000}}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/nodes/<node-id>"

# Delete a node
curl -sf -X DELETE \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/nodes/<node-id>"
```

### Edges — individual CRUD

```bash
# Add an edge
curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"sourceId":"<node-id>","targetId":"<node-id>","sourceHandle":"default"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/edges"

# Delete an edge
curl -sf -X DELETE \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/edges/<edge-id>"
```

Common sourceHandle values: `default`, `body` (foreach body), `done` (foreach completion), or custom branch names for conditionals.

### Runs

```bash
# Trigger a run
curl -sf -X POST "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/run"
# Returns 202 { status: "started" }

# List runs
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/runs"

# Get run detail with step results
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/WF-001/runs/<run-id>"
```

## End-to-end example: AI News Digest workflow

```bash
# 1. Create the workflow
WF=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"name":"AI News Digest","description":"Fetch AI news, summarize in Spanish"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows" | jq -r '.id')

# 2. Add nodes one by one
T1=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"nodeType":"trigger","name":"Start"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/nodes" | jq -r '.id')

A1=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"nodeType":"agent","name":"Fetch AI News","config":{"prompt":"Search for 10 recent AI news articles. Return a JSON array with keys: title, summary, url, date.","timeout_ms":120000}}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/nodes" | jq -r '.id')

FE=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"nodeType":"foreach","name":"Process Each Article"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/nodes" | jq -r '.id')

A2=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"nodeType":"agent","name":"Summarise & Translate","config":{"prompt":"Summarize this article in Spanish. If it is older than 1 month, return {\"discarded\": true}. Otherwise return {\"discarded\": false, \"title\": \"...\", \"summary_es\": \"...\"}","timeout_ms":180000}}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/nodes" | jq -r '.id')

A3=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"nodeType":"agent","name":"Final Summary","config":{"prompt":"Compile a final executive digest in Spanish from all the article summaries. Skip any that were discarded.","timeout_ms":120000}}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/nodes" | jq -r '.id')

E1=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"nodeType":"end","name":"Done"}' \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/nodes" | jq -r '.id')

# 3. Connect them with edges
curl -sf -X POST -H "Content-Type: application/json" \
  -d "{\"sourceId\":\"$T1\",\"targetId\":\"$A1\",\"sourceHandle\":\"default\"}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/edges"

curl -sf -X POST -H "Content-Type: application/json" \
  -d "{\"sourceId\":\"$A1\",\"targetId\":\"$FE\",\"sourceHandle\":\"default\"}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/edges"

curl -sf -X POST -H "Content-Type: application/json" \
  -d "{\"sourceId\":\"$FE\",\"targetId\":\"$A2\",\"sourceHandle\":\"body\"}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/edges"

curl -sf -X POST -H "Content-Type: application/json" \
  -d "{\"sourceId\":\"$FE\",\"targetId\":\"$A3\",\"sourceHandle\":\"done\"}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/edges"

curl -sf -X POST -H "Content-Type: application/json" \
  -d "{\"sourceId\":\"$A3\",\"targetId\":\"$E1\",\"sourceHandle\":\"default\"}" \
  "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/edges"

# 4. Verify the graph
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/graph" | jq '.nodes | length, .edges | length'

# 5. Trigger a run
curl -sf -X POST "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/run"

# 6. Check status
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/workflows/$WF/runs" | jq '.[0]'
```

## When to use full graph save vs individual node/edge CRUD

- **Creating a new workflow from scratch** — use the full graph `PUT .../graph` with all nodes and edges in one call. Simpler, atomic.
- **Modifying an existing workflow** — use individual `POST/PUT/DELETE .../nodes/:id` and `.../edges/:id`. Avoids clobbering the entire graph for a small change.
- **Complex restructuring** — `GET .../graph`, modify in memory, `PUT .../graph` back.

## Best practices

1. **Every workflow needs a trigger and an end node.** The trigger is the entry point; the end captures the final output.
2. **Keep agent prompts focused.** Each agent node should do one thing well. Use ForEach for iteration, Conditional for branching.
3. **Return structured data from agents.** If a downstream ForEach needs an array, say so in the prompt. The agent will format it.
4. **Don't mention `workflow_step_complete` in prompts.** The runner auto-injects instructions for the agent to call this tool.
5. **Use ForEach for batch processing.** Instead of "process all 10 items", make the upstream agent return an array and let ForEach iterate.
6. **Check run status after triggering.** `POST .../run` returns 202 immediately — poll `GET .../runs` for completion.

## Prohibited operations

- Never open or write to SQLite files directly
- Never create run or run_step records — those are the runner's territory
- Never hardcode `http://localhost:3001` — use `$GRANCLAW_API_URL`
- Never generate node/workflow IDs yourself — the server auto-assigns them
