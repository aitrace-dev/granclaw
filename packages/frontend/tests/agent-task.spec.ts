import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeededAgent, teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tests/ → frontend/ → packages/ → repo root (3 levels up)
const REPO_ROOT = path.resolve(__dirname, '../../../');
const SEED_DIR = path.resolve(REPO_ROOT, 'test-agents', 'pre-onboarded');

const AGENT_ID = 'test-agenttask-e2e';
const API = 'http://localhost:3001';
const TASK_TITLE = 'E2E Agent Task';

const wsConnected = (page: import('@playwright/test').Page) =>
  page.locator('[title="WS connected"]');

test.describe('Agent Task Creation', () => {
  test.beforeAll(async () => {
    await createSeededAgent(AGENT_ID, SEED_DIR);
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('agent creates a task via chat that appears in the task board', async ({ page }) => {
    // Allow up to 3 minutes: agent must run bash+curl (may make extra tool calls)
    test.setTimeout(180_000);

    await page.goto(`/agents/${AGENT_ID}/chat`);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    // Give the agent an explicit bash command with a hardcoded URL so it
    // doesn't need to look up env vars or explore the workspace.
    const input = page.getByPlaceholder(/message/i);
    await input.fill(
      `Run this bash command to create a task: ` +
      `curl -sf -X POST -H 'Content-Type: application/json' ` +
      `-d '{"title":"${TASK_TITLE}","status":"backlog"}' ` +
      `${API}/agents/${AGENT_ID}/tasks`
    );
    await input.press('Enter');

    // Wait for agent to start processing
    await expect(page.locator('div.animate-pulse').first()).toBeVisible({ timeout: 20_000 });

    // Poll the API until the task appears. The agent may make extra tool calls
    // before finishing — don't wait for streaming to end, just wait for the task.
    const deadline = Date.now() + 120_000;
    let created: { title: string; status: string } | undefined;
    while (Date.now() < deadline) {
      const res = await fetch(`${API}/agents/${AGENT_ID}/tasks`);
      const tasks = await res.json() as Array<{ title: string; status: string }>;
      created = tasks.find((t) => t.title === TASK_TITLE);
      if (created) break;
      await page.waitForTimeout(2_000);
    }

    expect(created, `Expected task "${TASK_TITLE}" to be created within 2 minutes`).toBeTruthy();
    expect(created?.status).toBe('backlog');

    // Navigate to the task board and verify the task card is visible
    await page.goto(`/agents/${AGENT_ID}/view/tasks`);
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 10_000 });
  });
});
