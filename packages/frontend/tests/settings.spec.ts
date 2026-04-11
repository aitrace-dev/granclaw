import { test, expect } from '@playwright/test';

/**
 * Provider settings onboarding flow tests.
 *
 * Tests run sequentially and are intentionally stateful — each test
 * depends on the state left by the previous one:
 *   1. fresh state (no provider) → warning visible in settings
 *   2. add a provider via the new multi-provider form → appears in list
 *   3. configured state → settings shows provider row with ✓ badge
 *   4. configured state → Remove button is visible
 *   5. remove → provider disappears from list
 *
 * beforeAll/afterAll clear ALL providers via REST so the suite starts
 * and ends clean. Do NOT add storageState or per-test resets.
 *
 * Requires the full stack to be running:
 *   - Backend (orchestrator) on :3001
 *   - Frontend (Vite) on :5173 or :5174 (worktree)
 *
 * Note: the SettingsPage was redesigned to a multi-provider list UI.
 * No #provider-select / #api-key-input IDs exist; no post-save navigation.
 * The old "Remove configuration" single-button flow is replaced by
 * per-provider "Remove" buttons.
 */

const API = 'http://localhost:3001';

async function clearAllProviders() {
  const res = await fetch(`${API}/settings/provider`, { method: 'DELETE' });
  // 204 = cleared, 404 = already gone — both are fine
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    console.warn('clearAllProviders returned', res.status);
  }
}

test.describe('Provider settings onboarding flow', () => {
  test.beforeAll(async () => {
    await clearAllProviders();
  });

  test.afterAll(async () => {
    await clearAllProviders();
  });

  test('fresh state: settings shows no-provider warning', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // Settings page renders a warning when no provider is configured
    await expect(page.getByText('No providers configured')).toBeVisible();
    // "Add provider" section must be present
    await expect(page.getByText('Add provider')).toBeVisible();
  });

  test('settings page: can save a provider configuration', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Select google in the add-provider form (first select = provider)
    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption('google');

    // Fill API key
    await page.getByPlaceholder('Paste your API key').fill('test-api-key-for-e2e');

    // Submit via the "Add" button
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Added ✓')).toBeVisible({ timeout: 5_000 });
  });

  test('after configuration: settings shows configured provider with ✓', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // The configured provider row shows the provider label and a ✓ badge
    await expect(page.getByText('Google Gemini')).toBeVisible();
    await expect(page.getByText('✓')).toBeVisible();
  });

  test('settings page: shows Remove button for configured provider', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Remove' }).first()).toBeVisible();
  });

  test('remove configuration: provider disappears from list', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // Auto-accept the confirm dialog
    page.on('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Remove' }).first().click();
    // Provider row disappears and warning reappears
    await expect(page.getByText('Google Gemini')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No providers configured')).toBeVisible({ timeout: 5_000 });
  });
});
