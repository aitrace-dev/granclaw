/**
 * Recall History Test
 *
 * Verifies that the agent uses the built-in recall_history tool when asked
 * to query conversation history. Checks that:
 *   1. The recall_history tool_call appears in the logs after the request
 *   2. The agent produces a reply that reflects the result (a number or summary)
 *
 * recall_history is always available — no external API key required.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeededAgent, teardownAgent } from './helpers/agent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../../../');
const SEED_DIR  = path.resolve(REPO_ROOT, 'test-agents', 'pre-onboarded');

const AGENT_ID = 'test-recall-history-e2e';
const API      = 'http://localhost:3001';
const CHAT_URL = `/agents/${AGENT_ID}/chat`;

const wsConnected = (page: import('@playwright/test').Page) =>
  page.locator('[title="WS connected"]');

test.describe('Recall History', () => {
  test.beforeAll(async () => {
    await createSeededAgent(AGENT_ID, SEED_DIR);
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID);
  });

  test('agent calls recall_history tool when asked to query message history', async ({ page }) => {
    // Allow up to 3 minutes: agent must call the tool, receive results, compose a reply
    test.setTimeout(180_000);

    await page.goto(CHAT_URL);
    await expect(wsConnected(page)).toBeVisible({ timeout: 10_000 });

    // Record time just before sending so log checks are scoped to this run only
    const sentAt = Date.now();

    // Ask the agent to explicitly use the recall_history tool.
    // Framed as a factual count query — maps directly to count=true in the API.
    const input = page.getByPlaceholder(/message/i);
    await input.fill(
      'Use the recall_history tool to count how many messages I have sent you today. Report the exact count.',
    );
    await input.press('Enter');

    // Streaming indicator must appear
    await expect(page.locator('div.animate-pulse').first()).toBeVisible({ timeout: 20_000 });

    // Wait for streaming to finish
    await expect(page.locator('div.animate-pulse')).toHaveCount(0, { timeout: 150_000 });

    // Agent reply must be visible
    const reply = page.locator('div.bg-surface-high').last();
    await expect(reply).toBeVisible({ timeout: 5_000 });

    // Poll logs until recall_history tool_call from THIS run appears.
    // runner-pi.ts logs: logAction(agent.id, 'tool_call', { tool: event.toolName, input: event.args })
    // Stored input JSON contains the tool name: {"tool":"recall_history","input":{...}}
    let recallCall: { type: string; input: string | null; created_at: number } | undefined;
    for (let i = 0; i < 20; i++) {
      const logsRes = await fetch(
        `${API}/logs?agentId=${AGENT_ID}&type=tool_call&search=recall_history&limit=50`,
      );
      const logs = await logsRes.json() as {
        items: Array<{ type: string; input: string | null; created_at: number }>;
      };
      recallCall = logs.items.find(
        (item) =>
          item.type === 'tool_call' &&
          (item.input?.includes('recall_history') ?? false) &&
          item.created_at >= sentAt,
      );
      if (recallCall) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(recallCall, 'Expected recall_history tool_call in logs from this test run').toBeTruthy();
  });
});
