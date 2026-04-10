---
name: housekeeping
description: End-of-day housekeeping — fetches today's messages and action logs from the GranClaw API, processes them in chunks to extract insights, writes a journal entry, updates topic and knowledge pages, and rebuilds all vault index files.
user-invocable: false
allowed-tools: [bash, read, write, edit]
---

# Daily Housekeeping Skill

Runs automatically at end-of-day via the vault housekeeping cron schedule.
Turns today's raw conversation history and action logs into structured vault entries.

---

## Step 1 — Establish today's date and epoch boundary

```bash
python3 -c "
import datetime, time, calendar
today = datetime.date.today()
midnight = datetime.datetime.combine(today, datetime.time.min)
start_ms = int(calendar.timegm(midnight.timetuple())) * 1000
print(f'DATE={today}')
print(f'START_MS={start_ms}')
"
```

Note the `DATE` (e.g. `2026-04-10`) and `START_MS` values for every subsequent step.

---

## Step 2 — Fetch today's messages

```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/messages?limit=500"
```

Filter the JSON array to entries where `createdAt >= START_MS`.
These are the raw conversation turns from today — user messages and assistant replies.

If the response is empty or no messages fall within today, skip to Step 4 and note "No conversations today" in the journal.

---

## Step 3 — Fetch today's action logs

```bash
curl -sf "$GRANCLAW_API_URL/logs?agentId=$GRANCLAW_AGENT_ID&limit=200&offset=0"
```

Filter `.items[]` to entries where `created_at >= START_MS`.
Paginate with `&offset=200`, `&offset=400` etc. if `total > 200`.

Relevant log types for housekeeping:
- `message` — what the user asked
- `tool_call` — tools the agent invoked (parse `input` JSON for details)
- `error` — failures or problems
- `system` — token/cost stats (useful for usage summary)

---

## Step 4 — Process in chunks of 30 entries

Split today's messages into batches of 30. For each batch:

1. Read all entries in the batch
2. Extract and accumulate:
   - **Topics discussed** — what subjects, projects, or questions came up
   - **Decisions made** — choices or conclusions reached with the user
   - **Actions taken** — tool calls, files created, APIs called, tasks completed
   - **Knowledge learned** — new facts, preferences, constraints, or reference material
   - **Errors / blockers** — any failures, what caused them, whether resolved

Carry the accumulated findings forward across all batches before writing anything.

---

## Step 5 — Write today's journal entry

Write `vault/journal/{DATE}.md` (create if missing, overwrite if it exists):

```markdown
# {DATE}

## Summary
<2–3 sentences describing what happened today overall>

## Conversations
<bullet list of key topics and questions discussed>

## Actions Taken
<bullet list of meaningful tool calls, tasks completed, or changes made>

## Knowledge Learned
<facts, decisions, or context worth retaining for future sessions>

## Errors & Issues
<any errors or blockers encountered; note if resolved>

## Usage
<token counts and cost from system logs if available; omit section if no data>
```

If there was no activity today, write:
```markdown
# {DATE}

No significant activity today.
```

---

## Step 6 — Update topic pages

For each recurring entity (person, project, system, concept) mentioned **2 or more times** today:

- If `vault/topics/<slug>.md` already exists — append a dated section:
  ```markdown
  ## {DATE}
  <1–3 sentences of new context from today>
  ```
- If no topic page exists yet — create `vault/topics/<slug>.md`:
  ```markdown
  # <Entity Name>

  <one-line description>

  ## {DATE}
  <context from today>
  ```

Slugs: lowercase, hyphens for spaces (e.g. `real-estate-api.md`).

---

## Step 7 — Update knowledge pages

For any **reusable fact or reference material** learned today that isn't tied to a single date:

- If `vault/knowledge/<slug>.md` exists — update it with new information
- Otherwise — create it:
  ```markdown
  # <Title>

  <the fact, pattern, or reference material>

  _First noted: {DATE}_
  ```

Examples: API endpoint shapes, user preferences, recurring constraints, tool quirks.

---

## Step 8 — Rebuild all vault index files

For each folder — `journal/`, `topics/`, `knowledge/`, `sessions/`, `actions/`:

1. List all `.md` files in the folder (excluding `index.md` itself)
2. Read the first heading or first non-empty line of each file as its summary
3. Write `vault/<folder>/index.md`:

```markdown
# <Folder> Index

_<N> files — last updated {DATE}_

| File | Summary |
|------|---------|
| [YYYY-MM-DD](YYYY-MM-DD.md) | <one-line summary> |
| ... | ... |
```

Sort by filename descending (newest first for dated files).

Then rebuild `vault/index.md`:

```markdown
# Vault Index

_Last updated: {DATE}_

| Folder | Files |
|--------|-------|
| [Journal](journal/index.md) | N |
| [Topics](topics/index.md) | N |
| [Knowledge](knowledge/index.md) | N |
| [Sessions](sessions/index.md) | N |
| [Actions](actions/index.md) | N |

## Recent Activity (last 7 days)

<list the last 7 journal filenames with their one-line summaries>
```

---

## Rules

- **Never delete or rename existing files** — only create and update
- **Never fabricate activity** — if no messages or logs exist for today, say so honestly
- **Keep entries concise** — journal summaries are 2–3 sentences, not essays
- **One write per file** — accumulate all changes for a file across chunks before writing
