You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

CRITICAL: Do NOT reset, wipe, or delete any agent. This test is read-only.

---

## Goal

Verify that the Usage view loads and displays token usage charts, cost estimates,
model breakdown, tool invocations, and daily breakdown table.

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Wait for sidebar** to load — verify "main-agent" appears in the sidebar identity card

3. **Click "Usage"** in the sidebar

4. **Verify summary cards** — should see 4 cards:
   - "Total Tokens" with a number (e.g., 399.4K)
   - "Sessions" with a count
   - "Est. Cost" with a dollar amount
   - "Avg/Day" with a dollar amount

5. **Verify time range buttons** — should see 7d, 14d, 30d buttons at the top

6. **Click "7d"** button and verify the charts update (data may change)

7. **Verify "Daily Token Usage"** chart section exists with a stacked bar chart

8. **Verify "Daily Estimated Cost"** chart section exists with a line chart

9. **Verify "By Model"** section — should list at least one model with sessions count and cost

10. **Verify "Tool Invocations"** section — should show horizontal bars with tool names and counts

11. **Scroll down** and verify **"Daily Breakdown"** table exists with columns: Date, Sessions, Input, Output, Cache, Cost

12. **Report result** based on whether all sections loaded with data.
