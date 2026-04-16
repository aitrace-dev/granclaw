// packages/backend/src/app-config.ts
//
// Enterprise UI overrides. Reads config-app.json from GRANCLAW_HOME.
// If the file is absent (standard install), all flags default to true (show everything).
// Enterprise control seeds this file at provision time to restrict certain UI elements.

import fs from 'fs';
import path from 'path';
import { GRANCLAW_HOME } from './config.js';

const CONFIG_APP_PATH = path.join(GRANCLAW_HOME, 'config-app.json');

export interface AppConfig {
  /** Show the workspace directory path input when creating an agent. Default: true */
  showWorkspaceDirConfig: boolean;
  /** Show the Brave Search configuration section in Settings. Default: true. Set false in enterprise where a key is provided server-side. */
  showBraveSearchConfig: boolean;
  /** Enable the Integrations page + dynamic-load the enterprise bundle. Default: false. Enterprise control seeds true. */
  enableIntegrations: boolean;
}

const DEFAULTS: AppConfig = {
  showWorkspaceDirConfig: true,
  showBraveSearchConfig: true,
  enableIntegrations: false,
};

export function getAppConfig(): AppConfig {
  try {
    const envPath = process.env.APP_CONFIG_PATH?.trim();
    const p = envPath ? path.resolve(envPath) : CONFIG_APP_PATH;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<AppConfig>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}
