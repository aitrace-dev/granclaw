import { test, expect } from '@playwright/test';

/**
 * Provider settings onboarding flow tests.
 *
 * Tests run sequentially and are intentionally stateful:
 *   1. fresh state (no provider) → CTA visible
 *   2. save a provider config → redirects to dashboard
 *   3. configured state → agent list UI visible
 *   4. settings page shows Remove when configured
 *   5. remove config → returns to onboarding CTA
 *
 * beforeAll/afterAll clear the provider via REST so the suite starts
 * and ends clean. Do NOT add storageState or per-test resets.
 *
 * Requires the full stack to be running:
 *   - Backend (orchestrator) on :3001
 *   - Frontend (Vite) on :5173
 *
 * Route note: `/` redirects to `/dashboard` via React Router Navigate.
 * After save/remove, SettingsPage calls navigate('/') which lands on /dashboard.
 */

async function clearProvider() {
  const res = await fetch('http://localhost:3001/settings/provider', { method: 'DELETE' });
  // 204 = cleared, 404 = already gone — both are fine
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    console.warn('clearProvider returned', res.status);
  }
}

test.describe('Provider settings onboarding flow', () => {
  test.beforeAll(async () => {
    await clearProvider();
  });

  test.afterAll(async () => {
    await clearProvider();
  });

  test('fresh state: dashboard shows setup CTA when no provider configured', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Get started with GranClaw')).toBeVisible();
    await expect(page.getByText('Configure provider')).toBeVisible();
    await expect(page.getByText('+ New Agent')).not.toBeVisible();
  });

  test('settings page: can save a provider configuration', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Provider Settings')).toBeVisible();

    await page.selectOption('#provider-select', 'google');
    await page.selectOption('#model-select', 'gemini-2.5-flash');
    await page.fill('#api-key-input', 'test-api-key-for-e2e');
    await page.click('button:has-text("Save")');
    // SettingsPage calls navigate('/') which React Router redirects to /dashboard
    await expect(page).toHaveURL('/dashboard');
  });

  test('after configuration: dashboard shows agent list and New Agent button', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Get started with GranClaw')).not.toBeVisible();
    await expect(page.getByText('+ New Agent')).toBeVisible();
  });

  test('settings page: shows Remove configuration when configured', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Remove configuration')).toBeVisible();
  });

  test('remove configuration: returns dashboard to onboarding state', async ({ page }) => {
    await page.goto('/settings');
    page.once('dialog', dialog => dialog.accept());
    await page.click('button:has-text("Remove configuration")');
    // SettingsPage calls navigate('/') which React Router redirects to /dashboard
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText('Get started with GranClaw')).toBeVisible();
  });
});
