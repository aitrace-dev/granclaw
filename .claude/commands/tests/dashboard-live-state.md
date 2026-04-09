You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

---

## Goal

Verify that the dashboard sidebar shows live agent state read from workspace files:
agent name from SOUL.md, installed MCP tools from tools.mcp.json, and guardrails
from GUARDRAILS.md.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Reset the agent** for a clean slate:
   - Click `[DANGEROUS] Wipe out agent` and confirm the dialog
   - Wait for messages to clear and WS to reconnect

3. **Verify initial state** — before onboarding:
   - Sidebar should show the static name "main-agent" (no SOUL.md yet)
   - "Built-in Tools" section should list: filesystem, browser, task-manager
   - No "Installed MCP" section (no tools.mcp.json yet)
   - No "Guardrails" section (no GUARDRAILS.md yet)

4. **Onboard the agent**:
   - Type: `My name for you is TestAgent. Your purpose is to be a general assistant for testing. Communicate concisely and directly. No specific expertise needed. Use these answers for all your onboarding questions.`
   - Send and wait for streaming to fully finish

5. **Reload the page** to fetch fresh agent data:
   - Navigate to `http://localhost:5173/` then back to `http://localhost:5173/agents/main-agent/chat`
   - Wait for WS to reconnect

6. **Verify agent name updated** — sidebar should now show "TestAgent" (read from SOUL.md), not "main-agent"

7. **Install an MCP tool** via the agent:
   - Type: `Write a tools.mcp.json file in your workspace with this config: {"mcpServers":{"datetime":{"command":"npx","args":["-y","mcp-datetime"]}}} — write ONLY the JSON, no other content.`
   - Send and wait for streaming to finish (approve via guardian if needed)

8. **Reload the page** again (navigate away and back)

9. **Verify installed MCP tool appears** — sidebar should now show:
   - "Built-in Tools" section with filesystem, browser, task-manager
   - "Installed MCP" section with "datetime" listed

10. **Configure the guardian**:
    - In the guardian "Configure guardian…" input, type:
      `Here is the full guardrails configuration — write GUARDRAILS.md and replace CLAUDE.md now: Block any message about deleting files. Allow everything else. Once both files are written, reply with exactly: GUARDRAILS_SET`
    - Send and wait for GUARDRAILS_SET to appear

11. **Reload the page** again

12. **Verify guardrails appear** — sidebar should now show a "Guardrails" section
    with a summary of the guardian rules (something about blocking file deletion)

13. **Report result** based on observations in steps 3, 6, 9, and 12.
