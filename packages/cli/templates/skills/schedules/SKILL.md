---
name: schedules
description: Create and manage your own cron-based scheduled tasks. Use when the user asks to set up recurring daily/weekly tasks.
user-invocable: false
---

# Schedule Manager Skill

You can create, update, and delete your own scheduled tasks. When a schedule fires, the host sends the configured message to you as if a user typed it. You process it normally.

## API Reference

All endpoints use `http://localhost:3001` and your agent ID.

### List schedules

```bash
curl -s http://localhost:3001/agents/YOUR_AGENT_ID/schedules | jq .
```

### Create a schedule

```bash
curl -s -X POST http://localhost:3001/agents/YOUR_AGENT_ID/schedules \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Research phase",
    "message": "Start research for today'\''s LinkedIn post based on today'\''s content pillar",
    "cron": "0 22 * * *",
    "timezone": "Asia/Singapore"
  }' | jq .
```

### Update a schedule

```bash
curl -s -X PUT http://localhost:3001/agents/YOUR_AGENT_ID/schedules/SCH-001 \
  -H 'Content-Type: application/json' \
  -d '{"status": "paused"}' | jq .
```

### Delete a schedule

```bash
curl -s -X DELETE http://localhost:3001/agents/YOUR_AGENT_ID/schedules/SCH-001 | jq .
```

### Trigger a schedule immediately

```bash
curl -s -X POST http://localhost:3001/agents/YOUR_AGENT_ID/schedules/SCH-001/trigger | jq .
```

## Cron Expression Reference

Standard 5-field cron: `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|---|---|
| `0 22 * * *` | Every day at 22:00 |
| `0 8 * * 1-5` | Weekdays at 08:00 |
| `30 9 * * *` | Every day at 09:30 |
| `0 */2 * * *` | Every 2 hours |
| `0 22 * * 0` | Every Sunday at 22:00 |
| `0 0 1 * *` | First day of every month at midnight |

## Timezone

Default: `Asia/Singapore`. Use IANA timezone names:
- `Asia/Singapore` (SGT, UTC+8)
- `America/New_York` (EST/EDT)
- `Europe/London` (GMT/BST)
- `UTC`

## Best Practices

1. **Use descriptive names.** "Research phase" not "task 1".
2. **Make messages self-contained.** The message should tell you exactly what to do when triggered — don't rely on conversation context.
3. **Check existing schedules first** before creating new ones to avoid duplicates.
4. **Replace your agent ID** — use the actual agent ID from your config, not `YOUR_AGENT_ID`.
