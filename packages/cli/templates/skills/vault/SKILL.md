---
name: vault
description: Your long-term memory and second brain. Use when logging work sessions, recording external actions, creating topic notes, writing knowledge notes, or searching for past context before starting work.
user-invocable: false
allowed-tools: Bash(find *), Bash(grep *), Bash(cat *), Bash(mkdir *), Read, Write
---

# Vault Skill — Your Second Brain

The vault is your long-term memory. It is where you record everything you do, learn, and encounter — so that future sessions can pick up exactly where past sessions left off. The task-board tells you *what to do*. The vault tells you *what was done and what was learned*.

---

## 1. MANDATORY: Search Before Work

**BEFORE starting ANY task**, search the vault for relevant context. This is non-negotiable. You may discover prior decisions, earlier attempts, related contacts, or lessons that change how you approach the task.

### Search Protocol

**Step 1 — Check topics directory for named entities:**
```bash
find vault/topics -name "*.md" | sort
```

**Step 2 — Search sessions and actions by keyword:**
```bash
grep -rl "keyword" vault/sessions/ vault/actions/ 2>/dev/null
grep -r "keyword" vault/sessions/ vault/actions/ --include="*.md" -l
```

**Step 3 — Check today's daily note (if it exists):**
```bash
cat vault/journal/$(date +%Y-%m-%d).md 2>/dev/null || echo "No daily note yet for today."
```

**Step 4 — Broad fallback search across entire vault:**
```bash
grep -r "keyword" vault/ --include="*.md" -l
```

**Step 5 — Report findings before proceeding.**

Always state what you found (or did not find) before starting the task. Example:
> "Searched vault for 'acme-api'. Found session log `vault/sessions/2025-03-12-acme-api-setup.md` and topic note `vault/topics/acme-corp.md`. Reviewing now before starting."

If nothing is found, say so and proceed. Do not skip the search step even when you are confident there is no prior context.

---

## 2. Vault Structure

```
vault/
  journal/          # Daily notes — one per day, summary of everything done
  sessions/         # Work session logs — one per task or working block
  actions/          # External action audit trail — emails, posts, API calls
  topics/           # Hub pages for recurring people, projects, tools, orgs
  knowledge/        # Learned facts and reference material
```

**Rules:**
- Every folder is created lazily — only create it when writing the first note in that folder.
- Never delete vault files. The vault is append-only. If something is wrong, write a correction note.
- Keep filenames short, lowercase, hyphen-separated, no special characters.
- Never store secrets, credentials, or API keys in the vault.

### Index Files

Every vault folder has an `index.md` that lists all files in that folder with a one-line summary.

```
vault/index.md                    ← master index: links to all sub-indexes, daily stats
vault/journal/index.md            ← list of daily notes with one-line summaries
vault/topics/index.md             ← list of topic files
vault/sessions/index.md           ← list of session logs
vault/actions/index.md            ← list of action logs
vault/knowledge/index.md          ← list of knowledge notes
```

**Index entry format:**
```markdown
- [YYYY-MM-DD.md](YYYY-MM-DD.md) — researched AI news, drafted LinkedIn post about Claude Code
```

**When to update indexes:**
- Every time you create or update a file in a vault folder → update that folder's `index.md`
- Add new entries at the top (most recent first)
- If the entry already exists, update its summary

**Master index (`vault/index.md`) format:**
```markdown
# Vault Index

Last updated: YYYY-MM-DD

## Folders
- [journal/](journal/index.md) — N daily notes
- [topics/](topics/index.md) — N topic files
- [sessions/](sessions/index.md) — N session logs
- [actions/](actions/index.md) — N action logs
- [knowledge/](knowledge/index.md) — N knowledge notes

## Recent Activity
- YYYY-MM-DD: <one-line summary of the day>
- YYYY-MM-DD: <one-line summary of the day>
```

---

## 3. Note Formats

Use these templates exactly. Always include the frontmatter block.

### Daily Note — `vault/journal/YYYY-MM-DD.md`

Create or update this note at the start and end of every working session.

```markdown
---
type: daily
date: YYYY-MM-DD
---

# YYYY-MM-DD

## Summary
<!-- One paragraph overview of the day's work. Written or updated at end of session. -->

## Sessions
<!-- Links to session logs created today -->
- [[YYYY-MM-DD-session-slug]]

## Actions
<!-- Links to external action logs created today -->
- [[YYYY-MM-DD-action-slug]]

## Completed Tasks
<!-- Task IDs from the task-board that were completed today -->
- TASK-123: Short description

## Notes
<!-- Anything else worth recording for continuity -->
```

### Session Log — `vault/sessions/YYYY-MM-DD-<slug>.md`

Write one session log per task or coherent block of work. Write it when the task is complete or at a natural stopping point.

```markdown
---
type: session
date: YYYY-MM-DD
task-id: TASK-123
---

# Session: <Short Title>

## What Was Done
<!-- Bullet list of concrete actions taken -->
-

## Decisions Made
<!-- Any choices made and the reasoning behind them -->
-

## Files Changed
<!-- List of files created, modified, or deleted -->
-

## Blockers / Open Questions
<!-- Anything unresolved that the next session should pick up -->
-

## See Also
<!-- [[wikilinks]] to related notes -->
- [[vault/journal/YYYY-MM-DD]]
- [[vault/topics/related-topic]]
```

### Action Log — `vault/actions/YYYY-MM-DD-<slug>.md`

Write this IMMEDIATELY after any external action — sending an email, posting to Slack, making an API call, submitting a form. Do not batch these. One action per file.

```markdown
---
type: action
date: YYYY-MM-DD
platform: email | slack | api | browser | other
---

# Action: <Short Title>

## What Was Done
<!-- One sentence: what action was taken and why -->

## Platform / Channel
<!-- Where the action happened: email address, Slack channel, API endpoint, URL -->

## Exact Content
<!-- The exact text sent, posted, or submitted. Copy verbatim. -->

```
<paste exact content here>
```

## Recipients / Targets
<!-- Who received this action or what resource was affected -->
-

## Screenshots / References
<!-- Paths to any browser session screenshots or reference files -->
-

## See Also
- [[vault/journal/YYYY-MM-DD]]
- [[vault/sessions/related-session]]
```

### Topic Note — `vault/topics/<name>.md`

Create a topic note when an entity (person, project, tool, organisation, concept) appears three or more times across sessions and actions. It becomes the hub for all related notes.

```markdown
---
type: topic
entity-type: person | project | tool | organization | concept
---

# <Topic Name>

## Description
<!-- Who or what this is. One paragraph. -->

## Key Facts
<!-- Bullet list of the most important things to remember -->
-

## History
<!-- Chronological log of significant events involving this topic. Append, never edit. -->
- YYYY-MM-DD: <event>

## Related Notes
<!-- [[wikilinks]] to sessions, actions, knowledge notes that mention this topic -->
-
```

### Knowledge Note — `vault/knowledge/<slug>.md`

Use for reference material, learned procedures, discovered facts, or anything you want to be able to look up later.

```markdown
---
type: knowledge
tags: []
---

# <Title>

## Summary
<!-- One paragraph: what this note covers and why it matters -->

## Content
<!-- The knowledge itself. Can be long. Use headers, lists, code blocks freely. -->

## Source
<!-- Where this came from: URL, session, conversation, document -->

## See Also
- [[vault/topics/related-topic]]
- [[vault/sessions/related-session]]
```

---

## 4. Write Protocol Summary

| Trigger | Action |
|---|---|
| Start working on any task | Search vault (see §1), create or update today's daily note |
| Complete a task | Write session log, update daily note sessions list, update relevant topic notes |
| Send email / post to Slack / make API call | Write action log IMMEDIATELY, add link to daily note |
| Learn something reusable | Write knowledge note |
| Entity (person/project/tool) appears 3+ times | Create topic note |
| End of session | Update daily note summary paragraph |

**Creating the daily note if it does not exist:**
```bash
mkdir -p vault/journal
# Then write vault/journal/$(date +%Y-%m-%d).md using the template above
```

**Appending a session link to the daily note:**
```bash
grep -q "session-slug" vault/journal/YYYY-MM-DD.md || \
  # Add the link under the ## Sessions section
```

---

## 5. Task-Board Integration

The task-board and the vault serve different purposes and must both be maintained:

| System | Purpose | Lifespan |
|---|---|---|
| Task-board | What to do next | Short-lived — tasks are completed and closed |
| Vault | What was done and learned | Long-lived — permanent record |

**Rules for integration:**

- **Before starting a task:** Search the vault for any prior context related to that task. Check by task ID (e.g. `grep -r "TASK-123" vault/`), by topic, and by keyword.
- **Daily notes reference task IDs:** When you complete a task, record its ID in the `## Completed Tasks` section of today's daily note.
- **Session logs reference tasks:** Always include the `task-id` field in the session log frontmatter so future searches can find it.
- **Never duplicate task descriptions:** The task-board holds the requirements. The vault holds the outcome. Do not copy task descriptions into vault notes — just reference the task ID.

---

## 6. `[[wikilinks]]` Convention

All cross-references between vault notes use wikilink format: `[[filename-without-extension]]`.

**Rules:**

- Always add a `## See Also` section at the bottom of every note you write.
- NEVER modify existing note content inline when adding a reference. Instead, append to `## Related Notes` or `## See Also`.
- When a session or action mentions a topic, open the topic note and append to its `## Related Notes` and `## History` sections.
- Link format is the filename without path prefix and without `.md` extension: `[[2025-03-12-acme-api-setup]]` not `[[vault/sessions/2025-03-12-acme-api-setup.md]]`.

**Example See Also block:**
```markdown
## See Also
- [[acme-corp]]
- [[2025-03-10-initial-outreach]]
- [[2025-03-12-acme-api-setup]]
```

**Updating a topic after writing a session:**
```bash
# Find the topic note
cat vault/topics/acme-corp.md

# Then append to its ## Related Notes and ## History sections
# Use Write tool to rewrite the file with the new content appended
```

---

## 7. Naming Conventions

| Note type | Pattern | Example |
|---|---|---|
| Daily note | `YYYY-MM-DD.md` | `2025-03-15.md` |
| Session log | `YYYY-MM-DD-short-slug.md` | `2025-03-15-api-auth-fix.md` |
| Action log | `YYYY-MM-DD-short-slug.md` | `2025-03-15-email-to-sarah.md` |
| Topic note | `lowercase-with-hyphens.md` | `acme-corp.md`, `sarah-jones.md` |
| Knowledge note | `lowercase-with-hyphens.md` | `oauth2-flow.md`, `stripe-webhooks.md` |

**Rules:**
- All lowercase. No uppercase letters anywhere in vault filenames.
- Hyphens only — no underscores, spaces, dots (except `.md`).
- Slugs must be under 50 characters.
- No special characters: no `@`, `#`, `&`, `(`, `)`, etc.
- Dates always use ISO format: `YYYY-MM-DD`.
- Make slugs descriptive but terse — prefer `fix-auth-token` over `fixed-the-authentication-token-issue`.

**Finding existing notes to avoid duplicates:**
```bash
# Before creating a topic note, check if one already exists
find vault/topics -name "*.md" | grep -i "keyword"

# Before creating a knowledge note
find vault/knowledge -name "*.md" | grep -i "keyword"
```

If a note already exists, update it rather than creating a duplicate.

---

## 8. Vault Housekeeping (Scheduled Task)

A default scheduled task runs daily to reindex and organize the vault. When triggered, do this:

### Housekeeping procedure

1. **Scan each vault folder** — list all `.md` files (except `index.md`)
2. **For each folder**, rebuild `index.md`:
   - Read each file's first heading or frontmatter to generate a one-line summary
   - Write entries in reverse chronological order (newest first)
   - Count total files
3. **Rebuild `vault/index.md`**:
   - Update folder counts
   - Add/update "Recent Activity" with the last 7 days' summaries from journal
   - Update the "Last updated" timestamp
4. **Check for orphans**:
   - Files referenced in `[[wikilinks]]` that don't exist → log a note
   - Topic candidates: entities appearing in 3+ files that don't have a topic note yet → create them
5. **Never delete or rename files** — only add/update index files

### Example index rebuild

```bash
# List all journal files
find vault/journal -name "*.md" ! -name "index.md" | sort -r

# For each, extract the first heading
head -5 vault/journal/2026-04-07.md | grep "^#"

# Then write vault/journal/index.md with the entries
```

This task is pre-configured as a scheduled task (SCH-001) and runs daily. The user chooses the time during onboarding.
