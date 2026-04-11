/**
 * Playwright config for running regression tests against the packaged
 * granclaw CLI tarball on port 18787. Used to verify that a fix survives
 * the full build → pack → install → start pipeline, not just the dev
 * stack. See CLAUDE.md "fix on dev, verify on tarball" rule.
 *
 * Expects a tarball install to already be running:
 *   GRANCLAW_HOME=/tmp/granclaw-verify-home AGENT_BASE_PORT=4100 \
 *     /tmp/granclaw-verify-prefix/bin/granclaw start --port 18787
 *
 * The test reads API_URL from env so the same spec files work against
 * both the dev stack (default `http://localhost:3001`) and the tarball
 * install (`http://localhost:18787`).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 300_000,
  use: {
    baseURL: 'http://localhost:18787',
    headless: true,
  },
  webServer: {
    command: 'echo "server expected to be running on :18787 (tarball install)"',
    url: 'http://localhost:18787/health',
    reuseExistingServer: true,
  },
});
