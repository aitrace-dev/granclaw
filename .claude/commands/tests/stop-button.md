You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete any agent.

---

## Goal

Verify that the Stop button appears during streaming and successfully
kills the running conversation.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Wait for sidebar** to load — verify "main-agent" appears

3. **Verify "Send" button** is visible in the chat input area

4. **Send a message** that will take a while to respond:
   - Type: `Write a very long detailed essay about the history of artificial intelligence from 1950 to 2025, covering every major milestone.`
   - Click Send

5. **Verify "Stop" button appears** — the Send button should turn into a red "Stop" button while the agent is streaming

6. **Click "Stop"** while the agent is still responding

7. **Verify the response is stopped**:
   - The message should end with "*(stopped)*"
   - The "Send" button should reappear (not "Stop")
   - The chat input should be enabled again

8. **Report result** based on whether Stop appeared and worked.
