You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  ✅ PASS — <brief summary of what you verified>
or
  ❌ FAIL — <what went wrong and where>

---

## Goal

Verify that tool calls and messages are persisted correctly when the browser is closed and
reopened mid-conversation, and that the session continues seamlessly after a reload.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Wait** for the agent WebSocket to connect:
   - The left sidebar must show `● ws`

3. **Send a research request** via the main chat input:
   - Type: `Use your browser tool to find out what the current Node.js LTS version is. Report just the version number.`
   - Press Enter or click Send

4. **Wait** for streaming to start (a pulsing bubble appears) and then fully stop
   (no more pulsing elements in the chat area). This may take up to 90 seconds as the
   browser tool fetches the page.

5. **Verify tool call badges appeared** — at least one `⚙` badge should be visible above
   the agent's reply bubble (these show which tools were called)

6. **Note the agent's reply** — it should contain a Node.js version number (e.g. "22.x.x"
   or similar). Remember this text for later assertions.

7. **Simulate close and reopen** — navigate away then back:
   - Go to `http://localhost:5173/` (the dashboard)
   - Then go back to `http://localhost:5173/agents/main-agent/chat`

8. **Wait** for WS to reconnect (`● ws` visible)

9. **Verify history loaded correctly** after reload:
   - The original user message ("Use your browser tool…") is still visible
   - At least one `⚙` tool call badge is still visible
   - The agent reply with the version number is still visible
   - No messages are missing or duplicated

10. **Send a follow-up** to continue the conversation:
    - Type: `Summarise what you just found in exactly one sentence.`
    - Press Enter or click Send

11. **Wait** for streaming to start and fully stop (up to 60 seconds)

12. **Verify the follow-up reply** — the agent should respond with a single sentence that
    references Node.js and the version it found. No tool calls are needed for this turn.

13. **Simulate close and reopen again**:
    - Go to `http://localhost:5173/`
    - Then go back to `http://localhost:5173/agents/main-agent/chat`

14. **Wait** for WS to reconnect

15. **Verify the full conversation history** is intact after the second reload:
    - First user message (research request) is visible
    - Tool call badge(s) from the first turn are visible
    - First agent reply (with version number) is visible
    - Second user message ("Summarise what you just found…") is visible
    - Second agent reply (one-sentence summary) is visible
    - No messages are missing or duplicated

16. **Report result** based on observations in steps 5, 9, 12, and 15.
