import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeededAgent, teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tests/ → frontend/ → packages/ → repo root (3 levels up)
const REPO_ROOT = path.resolve(__dirname, '../../../');
const SEED_DIR = path.resolve(REPO_ROOT, 'test-agents', 'pre-onboarded');

const AGENT_ID = 'test-workflow-e2e';
const API = 'http://localhost:3001';
const WORKFLOW_NAME = 'E2E Workflow Test';

const wsConnected = (page: import('@playwright/test').Page) =>
  page.locator('[title="WS connected"]');

test.describe('Agent Workflow Creation', () => {
  test.beforeAll(async () => {
    await createSeededAgent(AGENT_ID, SEED_DIR);
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('agent creates a workflow via chat that appears in the workflows view', async ({ page }) => {
    // Allow up to 3 minutes: agent must run bash+curl (may make extra tool calls)
    test.setTimeout(180_000);

    await page.goto(`/agents/${AGENT_ID}/chat`);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    // Natural instruction — the agent uses its workflow SKILL.md to figure out
    // how to call the REST API and create the workflow.
    const input = page.getByPlaceholder(/message/i);
    await input.fill(
      `Create a workflow called "${WORKFLOW_NAME}" with description "Created by e2e test".`
    );
    await input.press('Enter');

    // Wait for agent to start processing
    await expect(page.locator('div.animate-pulse').first()).toBeVisible({ timeout: 20_000 });

    // Poll the API until the workflow appears — the agent may make extra tool calls
    // before finishing, so don't wait for streaming to end.
    const deadline = Date.now() + 120_000;
    let created: { id: string; name: string; status: string } | undefined;
    while (Date.now() < deadline) {
      const res = await fetch(`${API}/agents/${AGENT_ID}/workflows`);
      const workflows = await res.json() as Array<{ id: string; name: string; status: string }>;
      created = workflows.find((w) => w.name === WORKFLOW_NAME);
      if (created) break;
      await page.waitForTimeout(2_000);
    }

    expect(created, `Expected workflow "${WORKFLOW_NAME}" to be created within 2 minutes`).toBeTruthy();
    expect(created?.status).toBe('active');

    // Navigate to the workflows view and verify the card is visible
    await page.goto(`/agents/${AGENT_ID}/view/workflows`);
    await expect(page.getByText(WORKFLOW_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('active')).toBeVisible({ timeout: 5_000 });
  });
});
