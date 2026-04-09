You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete any agent. This test is read-only.

---

## Goal

Verify that the Monitor view shows live process info, job queue status,
and auto-refreshes.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Wait for sidebar** to load — verify "main-agent" appears

3. **Click "Monitor"** in the sidebar

4. **Verify "Processes" section** — should show:
   - "Agent Process" card with PID, CPU%, MEM%, RSS, Uptime
   - "Guardian (Big Brother)" card with similar metrics

5. **Verify "Job Queue" section** — should show "N running, N queued" header
   - If idle: "No active jobs" message
   - If busy: processing/queued job cards with channel and message preview

6. **Verify the monitor auto-refreshes** — wait 3 seconds and check that the uptime or CPU values have changed

7. **Send a message to trigger activity** (optional):
   - Go back to Chat view
   - Send "Say hello"
   - Quickly switch to Monitor view
   - Should see a processing job and/or a Claude session

8. **Report result** based on whether process info loaded and displayed correctly.
