You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

---

## Goal

Verify the full MCP tool installation lifecycle: agent requests to install an MCP tool,
guardian requires user approval, user approves, tool is installed, and agent can use
the new tool on the next turn.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Reset the agent** for a clean slate:
   - Click `[DANGEROUS] Wipe out agent` and confirm the dialog
   - Wait for messages to clear and WS to reconnect

3. **Wait** for both WebSocket indicators:
   - Agent WS: `● ws` in the left sidebar
   - Guardian WS: `● connected` in the right guardian panel

4. **Onboard the agent**:
   - Type: `My name for you is TestAgent. Your purpose is to be a general assistant for testing. Communicate concisely and directly. No specific expertise needed. Use these answers for all your onboarding questions.`
   - Send and wait for streaming to fully finish (no pulsing elements)

5. **Configure the guardian** to require approval for tool installations:
   - In the guardian "Configure guardian…" input, type:
     `Here is the full guardrails configuration — write GUARDRAILS.md and replace CLAUDE.md now: Any response that involves creating or modifying tools.mcp.json (MCP tool configuration) requires user approval. Set approval_required to true for these. Allow all other actions. Once both files are written, reply with exactly: GUARDRAILS_SET`
   - Send and wait for GUARDRAILS_SET to appear in the guardian panel

6. **Ask the agent to install an MCP tool**:
   - In the main chat input, type:
     `Install the mcp-datetime MCP tool so you can work with dates and timezones. Write a tools.mcp.json file in your workspace with this config: {"mcpServers":{"datetime":{"command":"npx","args":["-y","mcp-datetime"]}}} — write ONLY the JSON, no other content.`
   - Send and wait

7. **Verify the approval request appears**:
   - An amber banner should appear in the main chat with "Awaiting approval" text
     and a note saying "Respond in the guardian panel →"
   - The agent's message should show "Awaiting approval"
   - In the guardian panel, a message should appear asking for approval
     (something like "Approval required... Do you approve?")

8. **Approve via guardian chat**:
   - In the guardian "Configure guardian…" input, type: `Yes, approve it`
   - Send it
   - Wait for the agent's response to replay (tool call badges + confirmation text)
   - The guardian panel should show "Approved" confirmation
   - The response should show the agent wrote `tools.mcp.json`

9. **Ask the agent to USE the newly installed tool**:
   - Type: `Use your mcp-datetime tool to tell me what the current time is in Tokyo.`
   - Send and wait for streaming to fully finish (up to 2 minutes — MCP server needs to start)

10. **Verify the agent used the datetime tool**:
    - The response should include a tool call badge referencing the datetime MCP
    - The response should contain a time in Tokyo (with timezone info like JST or Asia/Tokyo)
    - This proves the MCP tool was installed and is functional

11. **Report result** based on observations in steps 7, 8, and 10.
