/**
 * Provider Settings — E2E tests
 *
 * Tests the multi-provider Settings UI and agent creation provider picker.
 *
 * Requires:
 *   - Backend running at :3001
 *   - Frontend dev server at :5173
 *
 * Each test suite uses beforeAll/afterAll to set up and tear down provider
 * state via the REST API directly so tests don't depend on each other.
 */

import { test, expect, type Page } from '@playwright/test';

const API = 'http://localhost:3001';
const BASE_URL = 'http://localhost:5173';

// ── API helpers ───────────────────────────────────────────────────────────────

async function addProvider(provider: string, model: string, apiKey: string) {
  const res = await fetch(`${API}/settings/provider`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, apiKey }),
  });
  if (!res.ok) throw new Error(`addProvider failed: ${await res.text()}`);
}

async function removeProvider(provider: string) {
  await fetch(`${API}/settings/providers/${encodeURIComponent(provider)}`, { method: 'DELETE' });
}

async function listProviders(): Promise<{ provider: string; model: string }[]> {
  const res = await fetch(`${API}/settings/provider`);
  const data = await res.json() as { providers: { provider: string; model: string }[] };
  return data.providers ?? [];
}

async function cleanupAgent(id: string) {
  await fetch(`${API}/agents/${id}`, { method: 'DELETE' }).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function goToSettings(page: Page) {
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForLoadState('networkidle');
}

async function goToDashboard(page: Page) {
  await page.goto(`${BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
}

// ── Settings page — provider list ─────────────────────────────────────────────

test.describe('Settings page — configured providers list', () => {
  test.beforeAll(async () => {
    await addProvider('google', 'gemini-2.5-flash', 'test-google-key');
  });

  test.afterAll(async () => {
    await removeProvider('google');
  });

  test('shows configured provider with model and ✓ badge', async ({ page }) => {
    await goToSettings(page);
    await expect(page.getByText('Google Gemini')).toBeVisible();
    await expect(page.getByText('gemini-2.5-flash')).toBeVisible();
    await expect(page.getByText('✓')).toBeVisible();
  });

  test('shows Replace key and Remove buttons for configured provider', async ({ page }) => {
    await goToSettings(page);
    await expect(page.getByRole('button', { name: 'Replace key' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' }).first()).toBeVisible();
  });

  test('Replace key button reveals model + API key form', async ({ page }) => {
    await goToSettings(page);
    await page.getByRole('button', { name: 'Replace key' }).click();
    await expect(page.getByPlaceholder('Paste new API key')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('Cancel hides the replace key form', async ({ page }) => {
    await goToSettings(page);
    await page.getByRole('button', { name: 'Replace key' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByPlaceholder('Paste new API key')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace key' })).toBeVisible();
  });

  test('"Add provider" section only shows unconfigured providers', async ({ page }) => {
    await goToSettings(page);
    // Google is configured — it should not appear in the add-provider select
    const addSelect = page.locator('select').last();
    const options = await addSelect.locator('option').allTextContents();
    const hasGoogle = options.some(o => o.toLowerCase().includes('google'));
    expect(hasGoogle).toBe(false);
  });
});

// ── Settings page — add provider ──────────────────────────────────────────────

test.describe('Settings page — add provider', () => {
  const PROVIDER = 'groq';

  test.beforeAll(async () => {
    await removeProvider(PROVIDER);
  });

  test.afterAll(async () => {
    await removeProvider(PROVIDER);
  });

  test('add-provider form saves and shows new provider in list', async ({ page }) => {
    await goToSettings(page);

    // Select groq in the add-provider provider select
    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption({ label: /groq/i });

    // Fill API key
    await page.getByPlaceholder('Paste your API key').fill('test-groq-key');

    // Save
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Added ✓')).toBeVisible();

    // The new provider appears in the configured list
    await expect(page.getByText('Groq')).toBeVisible();

    // Verify API stored it
    const providers = await listProviders();
    expect(providers.some(p => p.provider === 'groq')).toBe(true);
  });
});

// ── Settings page — remove provider ──────────────────────────────────────────

test.describe('Settings page — remove provider', () => {
  test.beforeAll(async () => {
    await addProvider('openai', 'gpt-4.1', 'test-openai-key');
  });

  test.afterAll(async () => {
    await removeProvider('openai');
  });

  test('Remove button removes provider from list', async ({ page }) => {
    await goToSettings(page);

    // Confirm dialog will appear — auto-accept it
    page.on('dialog', d => d.accept());

    // Find the Remove button in the openai row
    await expect(page.getByText('OpenAI')).toBeVisible();
    const removeBtn = page.getByRole('button', { name: 'Remove' }).first();
    await removeBtn.click();

    // Provider disappears from list
    await expect(page.getByText('OpenAI')).not.toBeVisible({ timeout: 5_000 });

    // Verify API no longer returns it
    const providers = await listProviders();
    expect(providers.some(p => p.provider === 'openai')).toBe(false);
  });
});

// ── Settings page — Brave Search masked key ───────────────────────────────────

test.describe('Settings page — Brave Search', () => {
  test.beforeAll(async () => {
    await fetch(`${API}/settings/search`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'test-brave-key' }),
    });
  });

  test.afterAll(async () => {
    await fetch(`${API}/settings/search`, { method: 'DELETE' });
  });

  test('shows masked key input (••••) when Brave Search is configured', async ({ page }) => {
    await goToSettings(page);
    // A readonly password input with masked value should be visible
    const masked = page.locator('input[type="password"][readonly]').last();
    await expect(masked).toBeVisible();
    const val = await masked.inputValue();
    expect(val).toMatch(/^•+$/);
  });

  test('shows Configured ✓ label', async ({ page }) => {
    await goToSettings(page);
    await expect(page.getByText('Configured ✓').last()).toBeVisible();
  });

  test('Replace button reveals a new key input', async ({ page }) => {
    await goToSettings(page);
    await page.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByPlaceholder('Enter Brave Search API key')).toBeVisible();
  });
});

// ── Dashboard — agent creation provider picker ────────────────────────────────

test.describe('Dashboard — agent creation with provider picker', () => {
  const AGENT_ID = 'test-provider-picker-e2e';

  test.beforeAll(async () => {
    await addProvider('google', 'gemini-2.5-flash', 'test-google-key');
    await addProvider('openrouter', 'deepseek/deepseek-v3.2', 'test-or-key');
    await cleanupAgent(AGENT_ID);
  });

  test.afterAll(async () => {
    await cleanupAgent(AGENT_ID);
    await removeProvider('google');
    await removeProvider('openrouter');
  });

  test('create form shows provider dropdown with all configured providers', async ({ page }) => {
    await goToDashboard(page);
    await page.getByRole('button', { name: '+ New Agent' }).click();

    // Provider select should contain both configured providers
    const providerSelect = page.locator('select').first();
    const options = await providerSelect.locator('option').allTextContents();
    expect(options).toContain('google');
    expect(options).toContain('openrouter');
  });

  test('model dropdown updates when provider changes', async ({ page }) => {
    await goToDashboard(page);
    await page.getByRole('button', { name: '+ New Agent' }).click();

    const providerSelect = page.locator('select').first();
    const modelSelect = page.locator('select').nth(1);

    // Switch to openrouter
    await providerSelect.selectOption('openrouter');

    // Model dropdown should show openrouter models
    const modelOptions = await modelSelect.locator('option').allTextContents();
    expect(modelOptions.some(o => o.toLowerCase().includes('deepseek'))).toBe(true);
  });

  test('created agent stores correct provider in config', async ({ page }) => {
    await goToDashboard(page);
    await page.getByRole('button', { name: '+ New Agent' }).click();

    // Fill form
    await page.locator('input').first().fill(AGENT_ID);
    await page.locator('input').nth(1).fill('Test Provider Picker');

    // Select openrouter as provider
    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption('openrouter');

    // Create
    await page.getByRole('button', { name: 'Create' }).click();

    // Wait for navigation to chat page
    await page.waitForURL(`**/agents/${AGENT_ID}/chat`, { timeout: 10_000 });

    // Verify the agent's provider via API
    const res = await fetch(`${API}/agents/${AGENT_ID}`);
    const agent = await res.json() as { model: string };
    // Agent should use the openrouter model
    expect(agent.model).toContain('deepseek');
  });
});
