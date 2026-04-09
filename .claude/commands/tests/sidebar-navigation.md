You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete any agent. This test is read-only.

---

## Goal

Verify that all sidebar navigation buttons work and each view loads correctly.
This is a smoke test across all views.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Wait for sidebar** to load — verify "main-agent" appears in the identity card

3. **Verify all sidebar buttons exist**:
   - Chat
   - Tasks
   - Browser
   - Files
   - Workflows
   - Schedules
   - Monitor
   - Usage
   - Logs

4. **Click each view and verify it loads** (no crash, no blank screen):

   a. **Chat** — should show message input and conversation history
   b. **Tasks** — should show task board (may be empty or have tasks)
   c. **Browser** — should show "Browser Sessions" header and "Manual Login" section
   d. **Files** — should show workspace file tree
   e. **Workflows** — should show workflows list (may be empty)
   f. **Schedules** — should show schedules list or empty state
   g. **Monitor** — should show "Processes" section with Agent Process card
   h. **Usage** — should show summary cards (Total Tokens, Sessions, etc.)
   i. **Logs** — should show log entries with filter buttons

5. **Click GranClaw logo** in top bar — should navigate back to dashboard

6. **Verify dashboard** shows the agent list

7. **Click the agent row** — should navigate back to chat

8. **Report result** — all views loaded without errors.
