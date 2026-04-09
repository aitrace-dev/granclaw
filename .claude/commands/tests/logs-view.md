You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete any agent. This test is read-only.

---

## Goal

Verify that the per-agent Logs view loads, shows log entries with timestamps and types,
supports filtering, and allows expanding entries to see details.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Wait for sidebar** to load — verify "main-agent" appears

3. **Click "Logs"** in the sidebar

4. **Verify header** — should show "Logs" with a count like "50 of N"

5. **Verify filter buttons** — should see: All, Message, Tool Call, Error, System

6. **Verify log entries appear** — at least a few entries should be visible, each with:
   - Timestamp (HH:MM:SS format)
   - Date (e.g., Apr 7)
   - Type badge (message, system, tool_call, etc.)
   - Summary text

7. **Click "Message" filter** — verify only message-type entries are shown

8. **Click "System" filter** — verify only system-type entries are shown (should show exit codes and durations)

9. **Click "All" filter** to reset

10. **Click on a log entry** to expand it — verify it shows Input and/or Output sections with formatted content

11. **Click the entry again** to collapse it

12. **Verify "Load more" link** appears at the bottom if there are more than 50 entries

13. **Report result** based on whether all sections loaded and filters work.
