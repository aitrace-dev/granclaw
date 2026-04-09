You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete the main-agent. Only create and clean up "test-runner-e2e".

---

## Goal

Verify the full agent lifecycle: create a new agent from the dashboard, open its chat,
send a message, receive a streamed response, then clean up by deleting the test agent.

---

## Steps

1. **Navigate** to `http://localhost:5173/dashboard`

2. **Verify dashboard loads** — should show "Agents" heading and at least one existing agent

3. **Click "+ New Agent"** button

4. **Fill the create form**:
   - Agent ID: `test-runner-e2e`
   - Display name: `Test Runner`
   - Model: leave default

5. **Click "Create"**

6. **Verify auto-navigation to chat page**:
   - After creation, the app should navigate directly to `/agents/test-runner-e2e/chat`
   - Wait for the WebSocket connection indicator (the `●` dot next to status)
   - The chat input placeholder should be visible
   - The sidebar should show "Test Runner" as the agent name

7. **Send a test message**:
   - Type: `Reply with exactly the word PONG and nothing else.`
   - Press Enter

8. **Wait for the streaming response**:
    - The streaming indicator (animate-pulse) should appear
    - Wait for streaming to complete (animate-pulse disappears)

9. **Verify the agent responded**:
    - A response bubble should appear from the agent
    - The response should contain "PONG" (case-insensitive)

10. **Navigate back** to the dashboard (click the GranClaw logo in the top navbar)

11. **Clean up — delete the test agent**:
    - Find the "Test Runner" agent card
    - Click the "Delete" button on that card
    - Confirm the dialog if one appears

12. **Verify cleanup**:
    - The "Test Runner" agent should no longer appear in the dashboard
    - The original agent(s) should still be present

13. **Report result** based on whether:
    - Agent was created successfully
    - Chat loaded and connected via WebSocket
    - Message was sent and a response was received
    - Agent was deleted cleanly
