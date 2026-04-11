import { test, expect } from '@playwright/test';

/**
 * Chat state preservation across route navigation — regression A.
 *
 * User-reported scenario:
 *
 *   1. Open an agent's chat view.
 *   2. Send a prompt that triggers real tool calls (e.g. browser +
 *      filesystem) and stays busy for several seconds.
 *   3. Navigate to the main Agents dashboard.
 *   4. Navigate back to the same chat.
 *
 * Expected: tool calls that streamed while the user was away are
 * visible on return, the agent still shows as busy (Stop button), and
 * the user cannot start a second concurrent turn.
 *
 * Observed (the bug): chat shows nothing — no tool block, no streaming
 * indicator, Stop has reverted to Send even though the backend agent
 * is still calling tools (verifiable via `GET /agents/:id/monitor`).
 *
 * Root cause: ChatPage holds messages + isSending in local useState and
 * owns its own WebSocket. Leaving /agents/:id/chat for /dashboard
 * unmounts ChatPage entirely, destroying that state and closing the WS.
 * On return, ChatPage remounts, refetches the persisted message history
 * from the DB, but has no way to reattach to an in-flight turn — so the
 * streaming UI starts from a clean slate while the backend keeps chugging.
 *
 * This spec drives the exact user flow and asserts the post-return UI
 * reflects backend reality.
 */

import { createSeededAgent, teardownAgent } from './helpers/agent.ts';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENT_ID = 'test-view-switch-e2e';
// API base for the REST API. Defaults to the dev stack (backend :3001);
// override with API_URL=http://localhost:18787 when running against the
// packaged CLI tarball (same-origin — REST and UI both on 18787).
const API = process.env.API_URL ?? 'http://localhost:3001';

test.describe('View switch preserves chat streaming state (regression A)', () => {
  test.beforeAll(async () => {
    // Always start from scratch so we don't inherit any in-flight state.
    await fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});

    // Pull the configured provider and use its model so the test agent
    // actually responds — a plain create falls back to claude-sonnet-4-5,
    // which errors when the active provider is openrouter.
    const settings = await fetch(`${API}/settings/provider`).then(r => r.json()) as {
      provider?: string | null;
      model?: string | null;
    };
    if (!settings.provider || !settings.model) {
      throw new Error(
        'No provider configured on the dev stack. PUT /settings/provider with an openrouter or anthropic entry before running this spec.',
      );
    }
    const res = await fetch(`${API}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: AGENT_ID,
        name: 'View Switch Test',
        provider: settings.provider,
        model: settings.model,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create test agent: ${res.status} ${await res.text()}`);
    }
  });

  test.afterAll(async () => {
    await teardownAgent(AGENT_ID).catch(() => {
      fetch(`${API}/agents/${AGENT_ID}`, { method: 'DELETE' }).catch(() => {});
    });
  });

  // Browser tool calls hitting real Wikipedia can take ~60s per page
  // navigation. A two-page browse with a summary at the end comfortably
  // fills several minutes of real tool-call traffic — lots of room for
  // the dashboard round-trip to happen mid-stream.
  test.setTimeout(300_000);

  test('chat state survives a dashboard round trip while agent is busy', async ({ page }) => {
    await page.goto(`/agents/${AGENT_ID}/chat`);
    await expect(page.locator('[title="WS connected"]')).toBeVisible({ timeout: 10_000 });

    // Real browser-tool workload: navigate two Wikipedia articles and
    // summarise. The agent will issue multiple browser tool calls spaced
    // over tens of seconds — long enough that the /dashboard round-trip
    // happens while tools are still firing. Per the user's advice, this
    // kind of test can take up to a minute per page navigation.
    const input = page.getByPlaceholder(/message/i);
    await input.fill(
      'Use the browser tool: open https://en.wikipedia.org/wiki/Claude_Shannon and read the intro. Then open https://en.wikipedia.org/wiki/Information_theory and read the intro. Finally, reply with a two-sentence summary connecting the two topics. Do not take shortcuts — actually fetch both pages.',
    );
    await input.press('Enter');

    // Wait until at least one tool_call row has been persisted to the DB.
    // This is the precondition the regression specifically targets:
    //
    //   Without the fix (batched save at turn end) the FIRST tool_call
    //   only lands in the DB when the entire turn is done — meaning a
    //   user who rounds-trips via /dashboard mid-stream refetches an
    //   empty history and sees no tool calls.
    //
    //   With the fix, tool_call rows land in the DB as soon as the
    //   runner emits them, so the refetch on return picks them up.
    //
    // We poll /messages and bail out as soon as the first tool_call row
    // appears. If we time out, either the agent refused the prompt or
    // the backend fix was reverted.
    const waitForToolCallRow = async (timeoutMs = 60_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const msgs = await page.request
          .get(`${API}/agents/${AGENT_ID}/messages?channelId=ui&limit=50`)
          .then(r => r.json()) as Array<{ role: string }>;
        if (msgs.some(m => m.role === 'tool_call')) return msgs;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(
        'backend never persisted a tool_call row within 60s — either the agent refused ' +
        'the browser prompt or the backend fix (immediate-save) was reverted',
      );
    };
    await waitForToolCallRow();

    // Snapshot: how many message bubbles are on screen right now.
    const bubbleSelector = '[class*="rounded-lg"][class*="px-3"][class*="py-2"]';
    const bubblesBefore = await page.locator(bubbleSelector).count();
    expect(bubblesBefore).toBeGreaterThan(0);

    // ── The regression trigger: full route switch to /dashboard ──
    //    Different route pattern = React Router unmounts ChatPage
    //    entirely, destroying local state and the WebSocket. Splat
    //    routes inside /agents/:id/* do NOT have this effect; dashboard
    //    specifically exercises the "component unmount" path.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);

    // Tiny pause to let any in-flight DB writes flush while we're away.
    await new Promise((r) => setTimeout(r, 500));

    // ── Return to chat ──
    await page.goto(`/agents/${AGENT_ID}/chat`);
    await expect(page.locator('[title="WS connected"]')).toBeVisible({ timeout: 10_000 });

    // ── Core assertion: tool calls persisted to DB must render ──
    //
    // After the remount, ChatPage's mount-time `fetchMessages('ui')`
    // pulls the full saved history. The grouping logic collects
    // orphan tool_call rows into a synthetic agent bubble with a
    // toolCalls array, which renders through `ToolCallsBlock` as
    // either "N tool calls" or "Running {tool}…".
    //
    // Before the fix: no tool_call rows were saved until the turn
    // finished, so mid-turn refetches found nothing and this
    // assertion would time out.
    await expect(
      page.locator('text=/tool call|Running /').first(),
      'tool call block must render after a /dashboard round trip ' +
      'because tool_call rows were saved immediately (regression A fix)',
    ).toBeVisible({ timeout: 10_000 });

    // Sanity: the user prompt also survived the round trip (it's
    // saved at job-enqueue time, so this should always hold — but
    // proves the message list didn't get blown away entirely).
    const bubblesAfter = await page.locator(bubbleSelector).count();
    expect(
      bubblesAfter,
      'at least the user prompt must still be visible after round trip',
    ).toBeGreaterThan(0);
  });
});
