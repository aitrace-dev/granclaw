import { test, expect } from '@playwright/test';

/**
 * Usage view rendering — regression C.
 *
 * Two bugs observed in the parchment UI:
 *
 * 1. Empty-state messages ("No usage data", "No cost data") were
 *    rendered with `text-on-surface-variant/25` — that's 25% opacity
 *    of the medium-gray on-surface-variant token on the cream
 *    background. Basically invisible. Fresh agents looked like the
 *    Usage view was broken: empty chart boxes with no explanation.
 *
 * 2. The daily cost chart was a Chart.js line chart. With only one day
 *    of data (a fresh agent that just had its first session) a line
 *    chart draws no line — you'd see an empty canvas even though the
 *    data was there. Switched to a bar chart which renders one bar
 *    cleanly regardless of day count.
 *
 * API_URL lets the same spec run against the dev stack (default
 * :3001) and the packaged CLI tarball (:18787) with the tarball
 * playwright config.
 */

const API = process.env.API_URL ?? 'http://localhost:3001';

async function seedAgent(id: string) {
  await fetch(`${API}/agents/${id}`, { method: 'DELETE' }).catch(() => {});
  const settings = await fetch(`${API}/settings/provider`).then(r => r.json()) as {
    provider?: string | null; model?: string | null;
  };
  if (!settings.provider || !settings.model) {
    throw new Error('No provider configured — PUT /settings/provider first');
  }
  const res = await fetch(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: id, provider: settings.provider, model: settings.model }),
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status}`);
}

async function teardown(id: string) {
  await fetch(`${API}/agents/${id}`, { method: 'DELETE' }).catch(() => {});
}

test.describe('Usage view (regression C)', () => {
  const EMPTY_ID = 'test-usage-empty-e2e';

  test.beforeAll(async () => {
    await seedAgent(EMPTY_ID);
  });

  test.afterAll(async () => {
    await teardown(EMPTY_ID);
  });

  test('fresh empty agent shows a readable "no data" message', async ({ page }) => {
    await page.goto(`/agents/${EMPTY_ID}/view/usage`);
    await page.waitForLoadState('networkidle');

    // Summary cards always render (with zeros). This just confirms the
    // view didn't crash.
    await expect(page.locator('text=Total Tokens')).toBeVisible();
    await expect(page.locator('text=Est. Cost')).toBeVisible();

    // The empty-state message must be visible to a real user. Before
    // the fix it was rendered at /25 opacity, which meant text was in
    // the DOM but practically invisible (contrast ratio ~1.2 on cream).
    // We assert both that the text exists AND that its computed color
    // is meaningfully different from the background.
    const emptyMessage = page.locator('text=No usage data').first();
    await expect(emptyMessage).toBeVisible();

    const contrast = await emptyMessage.evaluate((el) => {
      const computedColor = getComputedStyle(el).color;
      const bgEl = el.closest('[class*="bg-"]') ?? el.parentElement!;
      const computedBg = getComputedStyle(bgEl).backgroundColor;
      // Quick heuristic: parse both and return max RGB delta.
      const parse = (c: string) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return [0, 0, 0];
        return m[1].split(',').slice(0, 3).map(Number);
      };
      const [fr, fg, fb] = parse(computedColor);
      const [br, bg, bB] = parse(computedBg);
      return Math.max(Math.abs(fr - br), Math.abs(fg - bg), Math.abs(fb - bB));
    });

    // A faint /25 value gave a delta around 15–25 (barely visible).
    // After the fix we want at least 60 channels of separation.
    expect(
      contrast,
      `"No usage data" must have real contrast against its background; delta=${contrast}`,
    ).toBeGreaterThanOrEqual(60);
  });
});

test.describe('Usage view single-day rendering (regression C)', () => {
  test('single-day cost chart actually draws something', async ({ page }) => {
    // Reuse the existing `test` agent which has exactly 1 day of usage
    // from earlier probe runs. If there's no data, the test is a
    // no-op and passes (the regression only fires when there's a
    // single day).
    const usage = await fetch(`${API}/agents/test/usage`).then(r => r.json())
      .catch(() => ({ daily: [] }));
    if (!Array.isArray(usage.daily) || usage.daily.length !== 1) {
      test.skip(true, `test agent has ${usage.daily?.length ?? 0} day(s) of data — needs exactly 1`);
    }

    await page.goto('/agents/test/view/usage');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500); // give Chart.js a tick to paint

    // Both canvases must render meaningful pixels. The bug was that
    // a Chart.js line chart with a single data point produced an
    // empty canvas — switching to bar chart fixes that.
    const pixelCounts = await page.evaluate(() => {
      const cs = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
      return cs.map((c) => {
        const ctx = c.getContext('2d');
        if (!ctx) return 0;
        const img = ctx.getImageData(0, 0, c.width, c.height);
        let painted = 0;
        for (let j = 3; j < img.data.length; j += 4) {
          if (img.data[j] > 0) painted++;
        }
        return painted;
      });
    });

    // Before the fix, the second canvas (cost chart) rendered ~9K
    // pixels on a single-day dataset — most of them axis gridlines,
    // not the data itself. After the fix it should render at least
    // 40K pixels (a full bar + axis + legend).
    expect(pixelCounts.length).toBeGreaterThanOrEqual(2);
    expect(
      pixelCounts[1],
      `cost chart must paint meaningful pixels for single-day data; got ${pixelCounts[1]}`,
    ).toBeGreaterThanOrEqual(40_000);
  });
});
