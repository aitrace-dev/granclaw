/**
 * Enterprise e2e global setup.
 *
 *   1. Wipe the enterprise test home (SQLite databases + any workspaces).
 *   2. Reset agents.config.json.
 *   3. Build the gologin extension dist so the backend's extension loader
 *      finds a fresh dist/index.js when it scans GRANCLAW_EXTENSIONS_DIR.
 *
 * The mock gologin API server and the backend both come up as `webServer`
 * entries in playwright.config.ts; nothing to start here.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ENTERPRISE_HOME = path.resolve(__dirname, 'home');
const GOLOGIN_EXT_DIR = path.resolve(__dirname, '..', '..', 'enterprise', 'extensions', 'gologin');

export default async function globalSetup(): Promise<void> {
  const dataDir = path.join(ENTERPRISE_HOME, 'data');
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    console.log('[enterprise-setup] wiped home/data');
  }
  const workspacesDir = path.join(ENTERPRISE_HOME, 'workspaces');
  if (fs.existsSync(workspacesDir)) {
    fs.rmSync(workspacesDir, { recursive: true, force: true });
    console.log('[enterprise-setup] wiped home/workspaces');
  }
  const configPath = path.join(ENTERPRISE_HOME, 'agents.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ agents: [] }, null, 2) + '\n');
  console.log('[enterprise-setup] reset agents.config.json');

  console.log('[enterprise-setup] rebuilding gologin extension dist…');
  execSync('npm run build', { cwd: GOLOGIN_EXT_DIR, stdio: 'inherit' });
  console.log('[enterprise-setup] extension built');
}
