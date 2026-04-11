import { test, expect } from '@playwright/test';

/**
 * Browser Integration — MCP isolation + agent-browser skill
 *
 * All tests run against a disposable `test-browser-e2e` agent created in
 * beforeAll and deleted in afterAll. NEVER touches main-agent.
 *
 * Requires the full stack to be running:
 *   - Backend (orchestrator) on :3001
 *   - Frontend (Vite) on :5173
 */

const API = 'http://localhost:3001';
const AGENT_ID = 'test-browser-e2e';

test.describe('Browser Integration — MCP Isolation', () => {
  test.setTimeout(30_000);

  test.beforeAll(async () => {
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
    const res = await fetch(`${API}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: AGENT_ID, name: 'Test Browser' }),
    });
    if (!res.ok) throw new Error(`Failed to create test agent: ${res.status}`);
    // Give bootstrap a moment to copy skills + .mcp.json into the workspace
    await new Promise((r) => setTimeout(r, 500));
  });

  test.afterAll(async () => {
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
  });

  test('agent workspace has its own .mcp.json with empty mcpServers', async ({ request }) => {
    const res = await request.get(
      `${API}/agents/${AGENT_ID}/files/read?path=${encodeURIComponent('.mcp.json')}`
    );
    expect(res.ok()).toBe(true);
    const data = await res.json() as { content: string };
    const mcp = JSON.parse(data.content);

    expect(mcp).toHaveProperty('mcpServers');
    expect(Object.keys(mcp.mcpServers)).toHaveLength(0);
  });

  // NOTE: the agent-browser skill was removed from the template — browser
  // automation is now an inline pi extensionFactory in runner-pi.ts. The
  // /skills API lists file-based skills only, so agent-browser no longer
  // appears there. The browser-wrapper.sh SKILL.md path is also gone.

  test('browser-sessions endpoint returns valid response', async ({ request }) => {
    const res = await request.get(`${API}/agents/${AGENT_ID}/browser-sessions`);
    expect(res.ok()).toBe(true);
    const data = await res.json() as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  test('Browser tab appears in sidebar and shows sessions view', async ({ page }) => {
    await page.goto(`http://localhost:5173/agents/${AGENT_ID}/chat`);

    const browserBtn = page.locator('button').filter({ hasText: 'Browser' });
    await expect(browserBtn).toBeVisible({ timeout: 5000 });

    await browserBtn.click();

    await expect(page.getByText('Browser Sessions', { exact: true })).toBeVisible({ timeout: 5000 });
  });
});
