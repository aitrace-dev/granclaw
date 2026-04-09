WaiYou are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

---

## Goal

Verify the full workflow lifecycle: create a multi-step workflow (research → combine →
summarise → write post) via the REST API, then use the UI to run it, wait for completion,
and verify all steps completed successfully with visible output.

---

## Steps

1. **Reset the agent** for a clean slate:
   - Call the reset endpoint directly:
     ```bash
     curl -s -X DELETE http://localhost:3001/agents/main-agent/reset
     ```

2. **Create a "Content Research Pipeline" workflow** via REST:
   ```bash
   curl -s -X POST http://localhost:3001/agents/main-agent/workflows \
     -H 'Content-Type: application/json' \
     -d '{"name": "Content Research Pipeline", "description": "Research websites, combine findings, summarise, and write a social post"}'
   ```
   Verify the response returns `WF-001`.

3. **Add Step 1 — "Fetch website data" (code step)**:
   ```bash
   curl -s -X POST http://localhost:3001/agents/main-agent/workflows/WF-001/steps \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "Fetch website data",
       "type": "code",
       "config": {
         "script": "echo '\''[{\"source\": \"TechCrunch\", \"headline\": \"AI agents are reshaping enterprise workflows\", \"summary\": \"Companies are adopting AI agent frameworks to automate complex multi-step processes\"}, {\"source\": \"HackerNews\", \"headline\": \"Show HN: Open-source workflow engine for LLM pipelines\", \"summary\": \"A new tool lets developers chain LLM calls with deterministic code steps\"}, {\"source\": \"The Verge\", \"headline\": \"Why AI workflows beat single-prompt approaches\", \"summary\": \"Multi-step AI pipelines produce more reliable results than one-shot prompts\"}]'\''",
         "timeout_ms": 10000
       }
     }'
   ```

4. **Add Step 2 — "Combine research" (code step)**:
   ```bash
   curl -s -X POST http://localhost:3001/agents/main-agent/workflows/WF-001/steps \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "Combine research",
       "type": "code",
       "config": {
         "script": "echo '\''{ \"topic\": \"AI Workflow Automation\", \"key_themes\": [\"enterprise adoption\", \"open-source tools\", \"multi-step pipelines\"], \"source_count\": 3, \"combined_text\": \"Three major sources confirm the trend: TechCrunch reports enterprise adoption of AI agent frameworks, HackerNews features a new open-source workflow engine, and The Verge explains why multi-step approaches outperform single prompts.\" }'\''",
         "timeout_ms": 10000
       }
     }'
   ```

5. **Add Step 3 — "Summarise findings" (code step)**:
   ```bash
   curl -s -X POST http://localhost:3001/agents/main-agent/workflows/WF-001/steps \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "Summarise findings",
       "type": "code",
       "config": {
         "script": "echo '\''{ \"summary\": \"AI workflow automation is accelerating across the industry. Enterprise companies are adopting agent frameworks, new open-source tools are emerging, and multi-step LLM pipelines are proving more reliable than single-prompt approaches.\", \"sentiment\": \"positive\", \"confidence\": 0.92 }'\''",
         "timeout_ms": 10000
       }
     }'
   ```

6. **Add Step 4 — "Write social post" (code step)**:
   ```bash
   curl -s -X POST http://localhost:3001/agents/main-agent/workflows/WF-001/steps \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "Write social post",
       "type": "code",
       "config": {
         "script": "echo '\''{ \"platform\": \"linkedin\", \"post\": \"The AI workflow revolution is here. Three signals this week: enterprises adopting agent frameworks, new open-source pipeline tools, and data showing multi-step LLM approaches outperform single prompts. The future of automation is not a single AI call — it is orchestrated pipelines of code + intelligence. #AI #Automation #LLM\", \"hashtags\": [\"AI\", \"Automation\", \"LLM\"], \"char_count\": 312 }'\''",
         "timeout_ms": 10000
       }
     }'
   ```

7. **Verify workflow was created correctly** via REST:
   ```bash
   curl -s http://localhost:3001/agents/main-agent/workflows/WF-001
   ```
   Verify: name is "Content Research Pipeline", has 4 steps in order (Fetch → Combine → Summarise → Write).

8. **Navigate to the chat page**:
   - Go to `http://localhost:5173/agents/main-agent/chat`
   - Wait for the WS connection indicator `● ws` to appear

9. **Switch to the Workflows view**:
   - Click the "Workflows" button in the left sidebar
   - Verify "Content Research Pipeline" appears in the workflow list
   - Verify it shows status "active"

10. **Click into the workflow**:
    - Click on the "Content Research Pipeline" row
    - Verify the workflow detail view loads showing:
      - The workflow name "Content Research Pipeline"
      - 4 steps listed: "Fetch website data", "Combine research", "Summarise findings", "Write social post"
      - Each step should show a type badge (CODE)
      - Run History section should show "No runs yet."

11. **Run the workflow from the UI**:
    - Click the "Run" button
    - Wait for the run to appear in the Run History section (may need a moment for polling)

12. **Verify the run completed**:
    - A new entry should appear in Run History with status "completed"
    - It should show "(manual)" as the trigger
    - It should show a duration (e.g., "0.1s")

13. **Click into the run to see step details**:
    - Click on the completed run entry
    - The Run Detail view should show all 4 steps with status indicators:
      - Step 1 "Fetch website data" — ● completed (green)
      - Step 2 "Combine research" — ● completed (green)
      - Step 3 "Summarise findings" — ● completed (green)
      - Step 4 "Write social post" — ● completed (green)
    - Each step should show a duration

14. **Expand step outputs to verify data flow**:
    - Click on "Fetch website data" to expand — verify output contains the 3 website entries (TechCrunch, HackerNews, The Verge)
    - Click on "Write social post" to expand — verify output contains the LinkedIn post text and hashtags

15. **Navigate back and verify run count**:
    - Click "← Back to workflow"
    - The Run History should still show the completed run
    - Click "← Back to workflows"
    - The workflow list should still show "Content Research Pipeline"

16. **Report result** based on observations in steps 9, 10, 12, 13, and 14.
