// packages/backend/src/providers-config.ts
import fs from 'fs';
import path from 'path';
import { GRANCLAW_HOME } from './config.js';

const CONFIG_PATH = path.join(GRANCLAW_HOME, 'providers.config.json');

interface ActiveProvider {
  provider: string;
  model: string;
  apiKey: string;
}

interface ProvidersConfig {
  active?: ActiveProvider;
}

function readConfig(): ProvidersConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as ProvidersConfig;
  } catch {
    return {};
  }
}

/** Returns provider + model — never returns the apiKey. */
export function getProvider(): { provider: string; model: string } | null {
  const cfg = readConfig();
  if (!cfg.active) return null;
  return { provider: cfg.active.provider, model: cfg.active.model };
}

/** Server-side only — returns the raw API key. Never send to frontend. */
export function getProviderApiKey(): string | null {
  return readConfig().active?.apiKey ?? null;
}

export function saveProvider(provider: string, model: string, apiKey: string): void {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ active: { provider, model, apiKey } }, null, 2));
}

export function clearProvider(): void {
  try { fs.unlinkSync(CONFIG_PATH); } catch { /* not found — fine */ }
}
