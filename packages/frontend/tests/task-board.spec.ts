import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeededAgent, teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tests/ → frontend/ → packages/ → repo root (3 levels up)
const REPO_ROOT = path.resolve(__dirname, '../../../');
const SEED_DIR = path.resolve(REPO_ROOT, 'test-agents', 'pre-onboarded');

const AGENT_ID = 'test-taskboard-e2e';
const API = 'http://localhost:3001';
const TASK_TITLE = 'My Manual E2E Task';

test.describe('Task Board — Manual Creation', () => {
  test.beforeAll(async () => {
    await createSeededAgent(AGENT_ID, SEED_DIR);
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('user can create a task manually via the task board UI', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}/view/tasks`);

    // The board renders 5 columns: BACKLOG, IN PROGRESS, SCHEDULED, TO REVIEW, DONE.
    // Each column has a + button in its header. The first + is BACKLOG.
    await page.getByRole('button', { name: '+' }).first().click();

    // The inline form appears autofocused on the title input
    const titleInput = page.getByPlaceholder('Task title…');
    await expect(titleInput).toBeVisible({ timeout: 3_000 });
    await titleInput.fill(TASK_TITLE);

    // Click Add to submit
    await page.getByRole('button', { name: 'Add' }).click();

    // Task card must appear in the BACKLOG column
    await expect(page.getByText(TASK_TITLE)).toBeVisible({ timeout: 5_000 });

    // Confirm the task was persisted via the API
    const tasksRes = await fetch(`${API}/agents/${AGENT_ID}/tasks`);
    const tasks = await tasksRes.json() as Array<{ title: string; status: string }>;
    const created = tasks.find((t) => t.title === TASK_TITLE);
    expect(created, `Expected task "${TASK_TITLE}" in API response`).toBeTruthy();
    expect(created?.status).toBe('backlog');
  });
});
