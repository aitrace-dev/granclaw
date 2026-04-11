/**
 * Worktree-only playwright config — targets the worktree vite dev server
 * on :5174 instead of the main stack on :5173. Backend stays on :3001.
 * Not committed (local test artifact).
 */
import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
  },
  webServer: {
    command: 'echo "server expected to be running on :5174"',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
  },
});
