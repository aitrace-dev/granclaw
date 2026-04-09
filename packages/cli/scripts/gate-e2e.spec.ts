/**
 * Prepublish gate — Step 6 Playwright smoke.
 *
 * This runs against a tarball-installed granclaw instance on port 18787.
 * The gate script (prepublish-gate.sh) boots the server with a temp
 * GRANCLAW_HOME before invoking this spec.
 *
 * Intentionally minimal: proves the published artifact can serve its own
 * frontend and expose a working REST API end-to-end. A fuller "create agent,
 * send message, assert streamed response" flow is tracked as a follow-up
 * because it depends on dashboard markup stability.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:18787';

test.describe('prepublish gate smoke', () => {
  test('dashboard HTML loads', async ({ page }) => {
    const response = await page.goto(BASE);
    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
  });

  test('/health returns ok', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
  });

  test('/agents API returns a JSON array', async ({ request }) => {
    const res = await request.get(`${BASE}/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // A fresh temp home seeds an empty agents.config.json — so length is 0.
    expect(body).toHaveLength(0);
  });

  test('frontend bundle contains the GranClaw root element', async ({ page }) => {
    await page.goto(BASE);
    // The Vite bundle ships with <div id="root"> as the React mount point.
    await expect(page.locator('#root')).toBeAttached();
  });
});
