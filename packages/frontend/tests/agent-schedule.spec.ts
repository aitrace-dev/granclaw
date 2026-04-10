import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeededAgent, teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tests/ → frontend/ → packages/ → repo root (3 levels up)
const REPO_ROOT = path.resolve(__dirname, '../../../');
const SEED_DIR = path.resolve(REPO_ROOT, 'test-agents', 'pre-onboarded');

const AGENT_ID = 'test-schedule-e2e';
const API = 'http://localhost:3001';
const SCHEDULE_NAME = 'E2E Daily Check';

const wsConnected = (page: import('@playwright/test').Page) =>
  page.locator('[title="WS connected"]');

test.describe('Agent Schedule Creation', () => {
  test.beforeAll(async () => {
    await createSeededAgent(AGENT_ID, SEED_DIR);
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('agent schedules a cron task via chat that appears in the schedules view', async ({ page }) => {
    // Allow up to 3 minutes: agent must read its SKILL.md and call the REST API
    test.setTimeout(180_000);

    await page.goto(`/agents/${AGENT_ID}/chat`);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    // Natural instruction — the agent uses its schedules SKILL.md to figure out
    // the cron expression and API call.
    const input = page.getByPlaceholder(/message/i);
    await input.fill(
      `Schedule a daily task called "${SCHEDULE_NAME}" that runs every day at 9am UTC ` +
      `with the message "Run the daily health check".`
    );
    await input.press('Enter');

    // Wait for agent to start processing
    await expect(page.locator('div.animate-pulse').first()).toBeVisible({ timeout: 20_000 });

    // Poll the API until the schedule appears — the agent may make extra tool calls
    // before finishing, so don't wait for streaming to end.
    const deadline = Date.now() + 120_000;
    let created: { id: string; name: string; status: string } | undefined;
    while (Date.now() < deadline) {
      const res = await fetch(`${API}/agents/${AGENT_ID}/schedules`);
      const schedules = await res.json() as Array<{ id: string; name: string; status: string }>;
      created = schedules.find((s) => s.name === SCHEDULE_NAME);
      if (created) break;
      await page.waitForTimeout(2_000);
    }

    expect(created, `Expected schedule "${SCHEDULE_NAME}" to be created within 2 minutes`).toBeTruthy();
    expect(created?.status).toBe('active');

    // Navigate to the schedules view and verify the entry is visible
    await page.goto(`/agents/${AGENT_ID}/view/schedules`);
    await expect(page.getByText(SCHEDULE_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(created!.id)).toBeVisible({ timeout: 5_000 });
  });
});
