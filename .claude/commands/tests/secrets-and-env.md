You are running an agentic E2E test. Use the Playwright MCP browser tools to interact
with the running app at http://localhost:5173. Navigate, click, type, and observe the UI.

At the end, print either:
  PASS — <brief summary of what you verified>
or
  FAIL — <what went wrong and where>

---

## Goal

Verify the per-agent secrets vault and .env editor work correctly:
- Admin can add/edit/delete secrets and env vars via the dashboard
- Agent can READ secrets (injected as env vars) but CANNOT create secrets itself
- Agent can read and use .env values

---

## Steps

1. **Navigate** to `http://localhost:5173/agents/main-agent/chat`

2. **Reset the agent** for a clean slate:
   - Click `[DANGEROUS] Wipe out agent` and confirm the dialog
   - Wait for messages to clear and WS to reconnect

3. **Onboard the agent**:
   - Type: `My name for you is TestAgent. Your purpose is to be a general assistant for testing. Communicate concisely and directly. No specific expertise needed. Use these answers for all your onboarding questions.`
   - Send and wait for streaming to finish

4. **Add a secret via the dashboard sidebar**:
   - In the sidebar "Secrets" section, find the SECRET_NAME input
   - Type `MY_TEST_TOKEN` in the name field
   - Type `super-secret-value-123` in the value/password field
   - Click "Add secret"
   - Verify `MY_TEST_TOKEN` appears in the secrets list with a lock icon
   - If a banner appears with an env var key to add to .env, note it (this is expected on first secret)

5. **Add an env var via the dashboard sidebar**:
   - In the sidebar "Environment" section, find the KEY input
   - Type `APP_MODE` in the key field
   - Type `testing` in the value field
   - Click the "+" button
   - Verify `APP_MODE=testing` appears in the environment list

6. **Verify agent can READ the secret** (injected as env var):
   - In the main chat, type: `What is the value of the MY_TEST_TOKEN environment variable? Use the Bash tool to run: echo $MY_TEST_TOKEN`
   - Send and wait for the response
   - The agent should report the value `super-secret-value-123`
   - This proves secrets are injected into the agent's environment

7. **Verify agent can READ the .env value**:
   - Type: `Read the .env file in your workspace and tell me what APP_MODE is set to.`
   - Send and wait for the response
   - The agent should report `APP_MODE=testing`

8. **Verify agent CANNOT create secrets itself**:
   - Type: `Write a file called secrets.json in your workspace with the content: {"api_key": "stolen-key-123"}`
   - Send and wait for the response
   - If the guardian is configured to block file writes, it should be blocked
   - If not blocked by guardian, the file may be created but this is acceptable —
     the key point is the agent cannot modify the encrypted secrets vault at data/secrets/

9. **Edit an existing secret via the dashboard**:
   - Click on `MY_TEST_TOKEN` in the secrets list (should highlight and enter edit mode)
   - The name field should be locked/disabled
   - Type `updated-value-456` in the value field
   - Click "Update"
   - Verify `MY_TEST_TOKEN` is still in the list

10. **Delete the secret and env var**:
    - Click the × button next to `MY_TEST_TOKEN` in secrets
    - Verify it disappears from the list
    - Click the × button next to `APP_MODE=testing` in environment
    - Verify it disappears from the list

11. **Verify secret is gone from agent environment**:
    - Type: `What is the value of MY_TEST_TOKEN now? Use Bash to run: echo $MY_TEST_TOKEN`
    - Send and wait
    - The value should be empty (secret was deleted and agent restarted)

12. **Report result** based on observations in steps 4-11.
