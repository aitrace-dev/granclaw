import { test, expect } from '@playwright/test';

/**
 * Chat flow tests.
 *
 * All tests run against a disposable `test-chat-e2e` agent created in
 * beforeAll and deleted in afterAll. NEVER touches main-agent.
 *
 * Requires the full stack to be running:
 *   - Backend (orchestrator) on :3001
 *   - Frontend (Vite) on :5173
 */

const AGENT_ID = 'test-chat-e2e';
const API = 'http://localhost:3001';
const CHAT_URL = `/agents/${AGENT_ID}/chat`;

// Helper: wait for WS connection indicator
const wsConnected = (page: import('@playwright/test').Page) =>
  page.locator('[title="WS connected"]');

test.describe('Chat', () => {
  test.beforeAll(async () => {
    // Clean slate — delete any leftover from previous runs
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
    // Create fresh
    const res = await fetch(`${API}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: AGENT_ID, name: 'Test Chat' }),
    });
    if (!res.ok) throw new Error(`Failed to create test agent: ${res.status}`);
  });

  test.afterAll(async () => {
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
  });

  test('dashboard loads and shows agent card', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await expect(page.getByText(`id: ${AGENT_ID}`)).toBeVisible();
  });

  test('clicking agent card navigates to chat', async ({ page }) => {
    await page.goto('/');
    await page.getByText(`id: ${AGENT_ID}`).click();

    await expect(page).toHaveURL(new RegExp(CHAT_URL));
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });
  });

  test('sends a message and receives a streamed reply', async ({ page }) => {
    await page.goto(CHAT_URL);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    const input = page.getByPlaceholder(/message/i);
    await input.fill('Reply with exactly: HELLO_WORLD');
    await input.press('Enter');

    // Streaming indicator appears then disappears when done
    await expect(page.locator('div.animate-pulse').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('div.animate-pulse')).toHaveCount(0, { timeout: 120_000 });

    // Agent reply bubble should contain HELLO_WORLD
    await expect(
      page.locator('div.bg-surface-high').filter({ hasText: /HELLO_WORLD/i }).last()
    ).toBeVisible({ timeout: 5_000 });
  });

  test('settings panel shows Secrets section', async ({ page }) => {
    await page.goto(CHAT_URL);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /Secrets/i }).click();
    await expect(page.getByPlaceholder('NAME')).toBeVisible();
  });

  test('schedules view loads', async ({ page }) => {
    await page.goto(CHAT_URL);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Schedules' }).click();

    await expect(page).toHaveURL(/\/view\/schedules/);
    await expect(page.getByPlaceholder(/message/i)).not.toBeVisible();
  });

  test('workflows view loads', async ({ page }) => {
    await page.goto(CHAT_URL);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Workflows' }).click();

    await expect(page).toHaveURL(/\/view\/workflows/);
    await expect(page.getByPlaceholder(/message/i)).not.toBeVisible();
  });

  test('guardian shows Soon badge in sidebar', async ({ page }) => {
    await page.goto(CHAT_URL);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    const sidebarItem = page.locator('[data-testid="guardian-coming-soon"]');
    await expect(sidebarItem).toBeVisible();
    await expect(sidebarItem.getByText('Soon')).toBeVisible();
  });
});
