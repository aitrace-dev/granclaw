import { defineConfig } from 'vitest/config';

/**
 * Root vitest config — scopes test discovery to our packages and excludes
 * the vendored .research/ checkouts (OpenClaw, etc) which carry their own
 * dependency graphs and unrelated test suites.
 *
 * The canonical command is still `npm run test`, which delegates to
 * `npm run test -w packages/backend`. This config makes a bare
 * `npx vitest run` from the root behave the same way.
 */
export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.research/**',
      'packages/frontend/tests/**', // playwright e2e, not vitest
      'packages/frontend/src/**',   // frontend unit tests run under packages/frontend/vitest.config.ts (jsdom env)
      'packages/cli/scripts/**',    // playwright gate smoke, not vitest
      'e2e/**',
    ],
  },
});
