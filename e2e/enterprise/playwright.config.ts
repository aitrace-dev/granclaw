/**
 * Playwright config for the gologin enterprise extension E2E suite.
 *
 * Three webServers come up before tests run:
 *
 *   1. fake-gologin-api (port 4567) — mock of api.gologin.com
 *   2. granclaw backend (port 3199) — loaded with the gologin extension,
 *      `require('gologin')` intercepted by register-gologin.js which returns
 *      a Chromium-backed fake SDK, and API_BASE pointed at the mock
 *   3. granclaw frontend (port 5299) — proxies to the enterprise backend
 *
 * The backend subprocess runs NODE_OPTIONS=--require ./fakes/register-gologin.js
 * so the fake `gologin` module intercepts BEFORE service.ts loads.
 */
import { defineConfig } from '@playwright/test';
import path from 'path';

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const ENTERPRISE_HOME = path.resolve(HERE, 'home');
const BACKEND_PORT = 3199;
const FRONTEND_PORT = 5299;
const MOCK_API_PORT = 4567;

// GRANCLAW_EXTENSIONS_DIR scans subdirectories; we point it at the parent
// of `enterprise/extensions/gologin/` so the real extension (with its just-
// rebuilt dist/) is discovered. The require('gologin') interception makes
// the extension talk to the fake SDK.
const EXTENSIONS_DIR = path.resolve(ROOT, 'enterprise', 'extensions');
const REGISTER_GOLOGIN = path.resolve(HERE, 'fakes', 'register-gologin.js');

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
  },
  webServer: [
    {
      command: `npx tsx ${path.resolve(HERE, 'fakes', 'gologin-api-server.mjs')}`,
      url: `http://localhost:${MOCK_API_PORT}/__healthz`,
      reuseExistingServer: false,
      timeout: 15_000,
      env: { GOLOGIN_MOCK_PORT: String(MOCK_API_PORT) },
    },
    {
      command: 'npx tsx src/index.ts',
      cwd: path.join(ROOT, 'packages/backend'),
      url: `http://localhost:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: String(BACKEND_PORT),
        GRANCLAW_HOME: ENTERPRISE_HOME,
        GRANCLAW_TEMPLATES_DIR: path.join(ROOT, 'packages/cli/templates'),
        AGENT_BASE_PORT: '3300',
        NODE_ENV: 'test',
        GRANCLAW_EXTENSIONS_DIR: EXTENSIONS_DIR,
        GOLOGIN_API_TOKEN: 'fake-token',
        GOLOGIN_API_BASE: `http://localhost:${MOCK_API_PORT}`,
        // Fast periodic sync so tests don't wait 2 minutes.
        GOLOGIN_SYNC_INTERVAL_MS: '500',
        NODE_OPTIONS: `--require ${REGISTER_GOLOGIN}`,
      },
    },
    {
      command: `npx vite --port ${FRONTEND_PORT}`,
      cwd: path.join(ROOT, 'packages/frontend'),
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        GRANCLAW_BACKEND_PORT: String(BACKEND_PORT),
      },
    },
  ],
});
