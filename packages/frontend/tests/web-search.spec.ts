import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeededAgent, teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tests/ → frontend/ → packages/ → repo root (3 levels up)
const REPO_ROOT = path.resolve(__dirname, '../../../');
const SEED_DIR = path.resolve(REPO_ROOT, 'test-agents', 'pre-onboarded');

const AGENT_ID = 'test-websearch-e2e';
const API = 'http://localhost:3001';
const CHAT_URL = `/agents/${AGENT_ID}/chat`;

const wsConnected = (page: import('@playwright/test').Page) =>
  page.locator('[title="WS connected"]');

test.describe('Web Search', () => {
  test.beforeAll(async () => {
    // Skip if Brave Search is not configured
    const searchRes = await fetch(`${API}/settings/search`);
    const { configured } = await searchRes.json() as { configured: boolean };
    if (!configured) {
      test.skip(true, 'Brave Search API key not configured — skipping web search tests');
      return;
    }

    // Skip if the LLM provider is not configured
    const providerRes = await fetch(`${API}/settings/provider`);
    const providerCfg = await providerRes.json() as { provider: string | null; model: string | null; configured: boolean };
    if (!providerCfg.configured) {
      test.skip(true, 'LLM provider not configured — skipping web search tests');
      return;
    }

    await createSeededAgent(AGENT_ID, SEED_DIR);
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('agent uses web_search tool to answer a live search query', async ({ page }) => {
    // Allow up to 3 minutes: agent must call Brave API and compose a reply
    test.setTimeout(180_000);

    await page.goto(CHAT_URL);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    // Record time just before sending so we can scope the logs check to this run only
    const sentAt = Date.now();

    // Send the search query
    const input = page.getByPlaceholder(/message/i);
    await input.fill('Search for real estate agencies in Malaga, Spain');
    await input.press('Enter');

    // Streaming indicator appears when agent starts thinking
    await expect(page.locator('div.animate-pulse').first()).toBeVisible({ timeout: 20_000 });

    // Wait for streaming to finish
    await expect(page.locator('div.animate-pulse')).toHaveCount(0, { timeout: 150_000 });

    // Agent reply should mention Malaga or real estate
    const reply = page.locator('div.bg-surface-high').last();
    await expect(reply).toBeVisible({ timeout: 5_000 });
    await expect(reply).toContainText(/malaga|málaga|real estate|inmobiliaria|agency|agencies/i);

    // Verify the web_search tool was called in THIS run (not from a stale prior run).
    // runner-pi.ts logs: logAction(agent.id, 'tool_call', { tool: event.toolName, input: event.args })
    // Stored input JSON: {"tool":"web_search","input":{"query":"..."}}
    const logsRes = await fetch(`${API}/logs?agentId=${AGENT_ID}&type=tool_call&search=web_search&limit=50`);
    const logs = await logsRes.json() as {
      items: Array<{ type: string; input: string | null; created_at: number }>;
    };

    const webSearchCall = logs.items.find(item =>
      item.type === 'tool_call' &&
      (item.input?.includes('web_search') ?? false) &&
      item.created_at >= sentAt
    );

    expect(webSearchCall, 'Expected web_search tool_call in logs from this test run').toBeTruthy();
  });
});
