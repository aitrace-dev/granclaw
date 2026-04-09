import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the prepublish gate's Step 6 smoke spec.
 * Scoped narrowly: only scripts/gate-e2e.spec.ts, one worker, no retries,
 * no HTML reporter (the gate runs in bash and only cares about exit code).
 */
export default defineConfig({
  testDir: './scripts',
  testMatch: 'gate-e2e.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    trace: 'off',
  },
});
