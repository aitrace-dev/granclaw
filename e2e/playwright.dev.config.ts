import { defineConfig } from '@playwright/test';

/**
 * Playwright config that targets the local dev stack instead of spinning
 * up a dedicated e2e backend on :3099. Use when the dev server is already
 * running on :3001 (backend) + :5173 (frontend) and you want fast iteration.
 *
 * Run: npx playwright test --config=e2e/playwright.dev.config.ts
 */
export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5173',
  },
});
