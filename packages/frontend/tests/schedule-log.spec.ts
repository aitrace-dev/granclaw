/**
 * schedule-log.spec.ts
 *
 * Playwright E2E: verifies the schedule run history flow.
 *
 * Flow:
 *   1. Create seeded agent + schedule via API
 *   2. Navigate to /agents/:id/view/schedules
 *   3. Click the schedule card → opens ScheduleRuns view
 *   4. Click "Run now" → new run appears in list
 *   5. Click the run → opens RunMessages view
 *   6. "Waiting for response..." shows initially (agent processing)
 *   7. Once the agent finishes, messages appear
 *
 * This test also verifies the user message is immediately saved
 * (i.e. the run shows the prompt before the response is ready).
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeededAgent, teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../../');
const SEED_DIR = path.resolve(REPO_ROOT, 'test-agents', 'pre-onboarded');

const AGENT_ID = 'test-schedule-log-e2e';
const API = 'http://localhost:3001';

test.describe('Schedule run history', () => {
  let scheduleId: string;

  test.beforeAll(async () => {
    await createSeededAgent(AGENT_ID, SEED_DIR);

    // Create a schedule directly via API
    const res = await fetch(`${API}/agents/${AGENT_ID}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Log test schedule',
        message: 'Reply with exactly one word: ok',
        cron: '0 9 * * *',
        timezone: 'UTC',
      }),
    });
    expect(res.ok, `Failed to create schedule: ${await res.text()}`).toBe(true);
    const schedule = await res.json() as { id: string };
    scheduleId = schedule.id;
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('clicking a schedule shows runs, Run now creates a run, clicking it shows messages', async ({ page }) => {
    test.setTimeout(120_000);

    // Navigate to the schedules panel
    await page.goto(`/agents/${AGENT_ID}/view/schedules`);
    await expect(page.getByText('Log test schedule')).toBeVisible({ timeout: 10_000 });

    // Click the schedule card → should open ScheduleRuns view
    await page.getByText('Log test schedule').click();
    await expect(page.getByText('Run history')).toBeVisible({ timeout: 5_000 });

    // Click "Run now"
    await page.getByRole('button', { name: 'Run now' }).click();

    // A run entry should appear in the list
    const runEntry = page.locator('button').filter({ hasText: /\d{1,2}\/\d{1,2}\/\d{4}/ }).first();
    await expect(runEntry).toBeVisible({ timeout: 10_000 });

    // Click the run entry → opens RunMessages view
    await runEntry.click();

    // While the agent is processing, the user message should appear immediately
    // (saved at the start of processNext before the LLM call)
    await expect(page.getByText('Reply with exactly one word: ok')).toBeVisible({ timeout: 10_000 });

    // "Waiting for response..." should show while agent is still running
    // (or messages if it completed very fast)
    const waitingText = page.getByText('Waiting for response...');
    const hasWaiting = await waitingText.isVisible().catch(() => false);
    if (hasWaiting) {
      // Wait for the agent to finish — waiting text should disappear
      await expect(waitingText).not.toBeVisible({ timeout: 90_000 });
    }

    // After completion, there should be at least the user message and one assistant message
    const messages = page.locator('.rounded-md').filter({ hasText: /.+/ });
    await expect(messages).toHaveCount(2, { timeout: 10_000 });
  });

  test('API: trigger returns runId and channelId, messages are retrievable', async () => {
    // Trigger the schedule via API
    const triggerRes = await fetch(`${API}/agents/${AGENT_ID}/schedules/${scheduleId}/trigger`, {
      method: 'POST',
    });
    expect(triggerRes.ok).toBe(true);
    const { runId, channelId } = await triggerRes.json() as { runId: string; channelId: string };
    expect(runId).toBeTruthy();
    expect(channelId).toBe(`sch-${runId}`);

    // The run should appear in the runs list
    const runsRes = await fetch(`${API}/agents/${AGENT_ID}/schedules/${scheduleId}/runs`);
    expect(runsRes.ok).toBe(true);
    const runs = await runsRes.json() as Array<{ id: string; channelId: string }>;
    const run = runs.find(r => r.id === runId);
    expect(run).toBeTruthy();
    expect(run!.channelId).toBe(channelId);

    // Poll until the user message appears (saved at job pickup, within 300ms + processing)
    const deadline = Date.now() + 30_000;
    let messages: Array<{ role: string; content: string }> = [];
    while (Date.now() < deadline) {
      const msgsRes = await fetch(
        `${API}/agents/${AGENT_ID}/messages?channelId=${encodeURIComponent(channelId)}&sortBy=asc&limit=10`
      );
      messages = await msgsRes.json() as Array<{ role: string; content: string }>;
      if (messages.length > 0) break;
      await new Promise(r => setTimeout(r, 500));
    }

    expect(messages.length, 'Expected at least the user message to be saved').toBeGreaterThan(0);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Reply with exactly one word: ok');
  });
});
