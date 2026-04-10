---
name: memory
description: Two-tier memory access — query the messages database via API for precise, searchable conversation history, and read/write the vault for organised semantic summaries. Use when you need to recall past conversations, find facts, or store knowledge for future sessions.
user-invocable: false
allowed-tools: [bash, read, write, edit]
---

# Memory Skill

Your memory has two tiers:

| Tier | Source | Best for |
|------|--------|----------|
| **Messages DB** | API — `$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/messages` | Exact quotes, keyword search, date-range queries, message counts |
| **Vault** | Files in `vault/` | Organised summaries, topic notes, knowledge articles, session logs |

Use the DB tier when you need precision — it is the verbatim record. Use the vault tier when you need context — it is the interpreted, organised memory.

---

## Capability 1 — Search Messages via API

### Query parameters

| Param | Type | Description |
|-------|------|-------------|
| `contains` | string | Filter messages whose content contains this substring (case-insensitive) |
| `from` | string | ISO date or datetime — include messages at or after this time (e.g. `2026-04-10` or `2026-04-10T09:00:00Z`) |
| `to` | string | ISO date or datetime — include messages at or before this time |
| `role` | string | Filter by role: `user`, `assistant`, or `tool_call` |
| `sortBy` | string | `asc` (default) or `desc` |
| `limit` | number | Max messages to return — capped at 200, default 50 |
| `count` | boolean | Return `{"count": N}` only — no rows |
| `format` | string | `csv` returns pipe-delimited `timestamp|role|content` (one per line); default is JSON |

### Examples

**Count how many times the user mentioned a topic today:**
```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/messages?count=true&role=user&contains=linkedin&from=2026-04-10"
# → {"count": 7}
```

**Fetch today's user messages as CSV (token-efficient):**
```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/messages?role=user&from=2026-04-10&format=csv&limit=100"
# → 1744243200000|user|What should I post about today?
#    1744246800000|user|Can you draft a LinkedIn post about AI agents?
```

**Find what the user said about a specific topic:**
```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/messages?contains=real+estate&role=user&format=csv&limit=50"
```

**Retrieve a specific date range:**
```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/messages?from=2026-04-07&to=2026-04-09&sortBy=desc&limit=200"
```

**Full recent history for context (JSON):**
```bash
curl -sf "$GRANCLAW_API_URL/agents/$GRANCLAW_AGENT_ID/messages?limit=50&sortBy=desc"
```

### CSV format

When `format=csv`, each line is:
```
<timestamp_ms>|<role>|<content>
```

The content field has newlines replaced with `\n`. Parse with:
```bash
# Print readable lines
curl -sf "...&format=csv" | while IFS='|' read -r ts role content; do
  echo "[$role] $content"
done
```

---

## Capability 2 — Search the Vault

The vault holds organised summaries, topic notes, knowledge articles, and journal entries. It is slower but richer in context.

### Search protocol

**Step 1 — Check vault index for overview:**
```bash
cat vault/index.md
```

**Step 2 — Search by keyword across all vault files:**
```bash
grep -rl "keyword" vault/ --include="*.md" 2>/dev/null
```

**Step 3 — Read matching files:**
```bash
cat vault/topics/relevant-topic.md
cat vault/knowledge/relevant-fact.md
```

**Step 4 — Check today's journal:**
```bash
cat vault/journal/$(date +%Y-%m-%d).md 2>/dev/null || echo "No entry today yet."
```

**Step 5 — Broad fallback:**
```bash
grep -r "keyword" vault/ --include="*.md" -l
```

Always state what you found (or didn't find) before proceeding.

---

## Capability 3 — Store in the Vault

Write to the vault when you learn something worth keeping across sessions.

### Knowledge note — `vault/knowledge/<slug>.md`

Use for reusable facts, learned procedures, discovered constraints, API shapes, user preferences.

```markdown
# <Title>

<The knowledge itself — facts, patterns, or reference material>

_First noted: YYYY-MM-DD_
```

### Topic note — `vault/topics/<slug>.md`

Create when an entity (person, project, tool, concept) appears in 3+ sessions. Slug: lowercase, hyphens.

```markdown
# <Entity Name>

<one-line description>

## YYYY-MM-DD
<context from this session>
```

Append a dated section each time the entity comes up again. Never overwrite history.

### Journal entry — `vault/journal/YYYY-MM-DD.md`

Append to today's journal when completing significant work. The housekeeping skill rebuilds these from message history automatically — but you can also append ad-hoc notes during the day.

```markdown
# YYYY-MM-DD

## Notes
- <what happened, what you learned, decisions made>
```

---

## Rules

- **DB first for facts** — if you need exact quotes or counts, always query the DB rather than guessing from vault summaries
- **Vault first for context** — if you need background on a topic, search vault before querying the DB
- **Never fabricate** — if a query returns nothing, say so; don't invent past context
- **Keep notes terse** — one fact per knowledge note, one-line topic entries; save verbose detail for the housekeeping journal
- **Never delete vault files** — vault is append-only; write corrections as new entries
