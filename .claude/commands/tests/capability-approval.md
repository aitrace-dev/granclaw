You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

---

## Goal

Verify the 3-tier guardian approval system: when the guardian flags an agent response as
needing user approval, the dashboard shows Approve/Deny buttons and the agent's response
is held until the user decides.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Reset the agent** for a clean slate:
   - Click `[DANGEROUS] Wipe out agent` and confirm the dialog
   - Wait for messages to clear and WS to reconnect

3. **Wait** for both WebSocket indicators to show connected:
   - Agent WS: `● ws` in the left sidebar
   - Guardian WS: `● connected` in the right guardian panel

4. **Onboard the agent** via the main chat input:
   - Type: `My name for you is TestAgent. Your purpose is to be a general assistant for testing. Communicate concisely and directly. No specific expertise needed. Use these answers for all your onboarding questions.`
   - Send it and wait for streaming to finish (no more pulsing elements)

5. **Configure the guardian** to require approval for file-related actions:
   - In the guardian "Configure guardian…" input, type:
     `Here is the full guardrails configuration — write GUARDRAILS.md and replace CLAUDE.md now: Any response that involves writing, creating, or modifying files requires user approval. Set approval_required to true for these. Allow everything else. Once both files are written, reply with exactly: GUARDRAILS_SET`
   - Send it and wait for the guardian to finish responding
   - Verify the guardian replied with GUARDRAILS_SET or similar confirmation

6. **Trigger an action that requires approval**:
   - In the main chat input, type: `Create a file called hello.txt with the content "hello world" in your workspace.`
   - Send it and wait

7. **Verify the pending approval appears**:
   - An amber banner should appear in the main chat with "Awaiting approval" text
     and a note saying "Respond in the guardian panel →"
   - The agent's message should show "Awaiting approval" text
   - In the guardian panel, a message should appear asking the user to approve
   - The agent's response is NOT yet visible (held by guardian)

8. **Approve via guardian chat**:
   - In the guardian "Configure guardian…" input, type: `Yes, approve it`
   - Send it
   - The banner should disappear
   - The guardian panel should show "Approved" confirmation
   - The agent's response should now appear (streaming replays)
   - Wait for streaming to fully stop

9. **Verify the approved response** — the agent should confirm it created the file

10. **Test the deny flow** — send another file-write request:
    - Type: `Create another file called secret.txt with the content "top secret" in your workspace.`
    - Send it and wait for the approval request to appear in the guardian panel

11. **Deny via guardian chat**:
    - In the guardian "Configure guardian…" input, type: `No, deny this`
    - Send it
    - A red blocked message should appear with "Denied by user" text
    - The guardian panel should show "Denied" confirmation
    - The file should NOT have been created

12. **Report result** based on observations in steps 7, 8, 9, 11.
