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
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ active: { provider, model, apiKey } }, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

export function clearProvider(): void {
  try { fs.unlinkSync(CONFIG_PATH); } catch { /* not found — fine */ }
}

// ── Search config ─────────────────────────────────────────────────────────────

export interface SearchConfig {
  provider: 'duckduckgo' | 'brave';
  apiKey?: string; // only for brave
}

export function getSearch(): SearchConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { search?: SearchConfig };
    return parsed.search ?? { provider: 'duckduckgo' };
  } catch {
    return { provider: 'duckduckgo' }; // default
  }
}

export function getSearchApiKey(): string | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { search?: SearchConfig };
    return parsed.search?.apiKey ?? null;
  } catch {
    return null;
  }
}

export function saveSearch(provider: 'duckduckgo' | 'brave', apiKey?: string): void {
  // Read existing config to preserve the `active` section
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch { /* first write */ }

  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  const searchSection: SearchConfig = provider === 'brave' && apiKey
    ? { provider: 'brave', apiKey }
    : { provider: 'duckduckgo' };
  fs.writeFileSync(tmp, JSON.stringify({ ...existing, search: searchSection }, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

export function clearSearch(): void {
  // Reset to duckduckgo (the default) by removing the search section
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch { return; }
  const { search: _removed, ...rest } = existing;
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rest, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}
