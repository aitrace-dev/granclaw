You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete the main-agent. Only create and clean up "test-agent-e2e".

---

## Goal

Verify that a new agent can be created from the dashboard, appears in the list,
and can be opened for chat. Clean up by deleting the test agent at the end.

---

## Steps

1. **Navigate** to `http://localhost:5173/dashboard`

2. **Verify dashboard loads** — should show "Agents" heading and at least one agent (main-agent)

3. **Click "+ New Agent"** button

4. **Verify create form appears** with 3 fields:
   - Agent ID input
   - Display name input
   - Model selector

5. **Fill the form**:
   - Agent ID: `test-agent-e2e`
   - Display name: `Test Agent`
   - Model: leave default (Claude Sonnet 4.5)

6. **Click "Create"**

7. **Verify the new agent appears** in the agent list:
   - Should show "Test Agent" with status badge
   - Should show model "claude-sonnet-4-5"

8. **Click on the new agent row** to open its chat

9. **Verify chat page loads** — should show the chat input and sidebar

10. **Navigate back** to dashboard (click GranClaw logo in top bar)

11. **Clean up** — delete the test agent:
    - Hover over "Test Agent" row, click "Delete"
    - Confirm the dialog

12. **Verify the test agent is gone** from the list — only the original agent(s) should remain

13. **Report result** based on whether create, navigate, and delete all worked.
