import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Frontend unit-test config.
 *
 * Separate from vite.config.ts so test runs don't pay for dev-server proxy
 * setup or the CLI package.json import. Playwright e2e lives elsewhere
 * (packages/frontend/tests/*.spec.ts) — only unit tests run here.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
