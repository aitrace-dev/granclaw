---
name: memory
description: Two-tier memory — use the recall_history tool for precise factual queries (exact quotes, keyword search, time ranges, counts), and search vault files for long-term summaries and context. Read this to know which tier to use.
user-invocable: false
allowed-tools: [bash, read, write, edit]
---

# Memory Skill — Two-Tier Recall

You have two ways to access memory. Choose the right one:

| Question type | Use | Why |
|---|---|---|
| "What did I say about X?" | `recall_history` tool | Verbatim, searchable, timestamped |
| "How many times did we discuss Y?" | `recall_history` tool with `count=true` | DB aggregate, no hallucination |
| "What happened between 1am and 2am?" | `recall_history` tool with `from`/`to` | Precise time-range query |
| "What did we work on yesterday?" | Search vault files | Organised summaries, narrative |
| "Who is Sarah? What's the status of project X?" | Search vault files | Topic notes, session logs |

---

## Tier 1 — recall_history tool

You have a built-in `recall_history` tool. Call it directly — no curl, no bash needed.

### Parameters

| Param | Type | Description |
|-------|------|-------------|
| `contains` | string | Filter messages containing this substring |
| `from` | string | ISO date/datetime — at or after (e.g. `2026-04-10` or `2026-04-10T09:00:00Z`) |
| `to` | string | ISO date/datetime — at or before |
| `role` | `user` \| `assistant` \| `tool_call` | Filter by who sent it |
| `sortBy` | `asc` \| `desc` | Time order (default: asc) |
| `limit` | number | Max rows — capped at 200, default 50 |
| `count` | boolean | Return `{"count": N}` only — no rows |
| `format` | `json` \| `csv` | `csv` = pipe-delimited `timestamp|role|content` — use for token efficiency |

### Examples

**Count messages on a topic today:**
→ call `recall_history` with `count=true`, `contains="linkedin"`, `from="2026-04-10"`

**What did the user say about real estate?**
→ call `recall_history` with `role="user"`, `contains="real estate"`, `format="csv"`, `limit=20`

**What happened between 1am and 2am?**
→ call `recall_history` with `from="2026-04-10T01:00:00Z"`, `to="2026-04-10T02:00:00Z"`, `format="csv"`

**Recent history for context:**
→ call `recall_history` with `limit=30`, `sortBy="desc"`

CSV output format: `1744243200000|user|What should I post today?`

---

## Tier 2 — Vault files

The vault holds organised summaries written by the housekeeping skill. Use it when you need narrative context, not raw quotes.

**Check vault index first:**
```bash
cat vault/index.md
```

**Search by keyword:**
```bash
grep -rl "keyword" vault/ --include="*.md"
```

**Read a specific file:**
```bash
cat vault/topics/project-name.md
cat vault/knowledge/some-fact.md
cat vault/journal/2026-04-10.md
```

---

## Writing to the vault

When you learn something worth keeping across sessions:

**Knowledge note** — `vault/knowledge/<slug>.md`
```markdown
# <Title>
<The fact, pattern, or reference material>
_First noted: YYYY-MM-DD_
```

**Topic note** — `vault/topics/<slug>.md` (slug: lowercase, hyphens)
```markdown
# <Entity Name>
<one-line description>

## YYYY-MM-DD
<context from this session>
```

Append dated sections — never overwrite existing history.

---

## Rules

- **Never fabricate** — if `recall_history` returns nothing, say so
- **count before pulling rows** — for aggregate questions use `count=true` first
- **csv over json** when you need content — saves tokens
- **vault is append-only** — write corrections as new entries, never delete
