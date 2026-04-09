import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,             // serial — tests share a live backend + Claude sessions
  timeout: 60_000,        // Claude CLI can take ~5s to respond
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  // Do not start a dev server — assumes `npm run dev` is already running
  webServer: {
    command: 'echo "server expected to be running"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
