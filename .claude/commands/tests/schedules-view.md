You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete any agent. This test is read-only.

---

## Goal

Verify that the Schedules view displays agent schedules with cron times,
status, and action buttons (pause/resume, run now, delete).

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Wait for sidebar** to load — verify "main-agent" appears

3. **Click "Schedules"** in the sidebar

4. **Check if schedules exist**:
   - If "No schedules yet" message appears → create one via API for testing:
     ```
     curl -X POST http://localhost:3001/agents/main-agent/schedules \
       -H 'Content-Type: application/json' \
       -d '{"name":"Test Schedule","message":"Test message","cron":"0 0 * * *","timezone":"Asia/Singapore"}'
     ```
     Then refresh the page

5. **Verify schedule card** shows:
   - Schedule name
   - Schedule ID (SCH-XXX)
   - Message text (wrapped, not truncated)
   - Cron schedule in human-readable format (e.g., "Daily at 00:00")
   - Timezone
   - Next run time (relative)
   - Status indicator (green dot for active, yellow for paused)

6. **Verify action buttons**: Pause, Run now, Delete

7. **Report result** based on whether the schedule view renders correctly.
