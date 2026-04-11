// packages/backend/src/providers-config.ts
import fs from 'fs';
import path from 'path';
import { GRANCLAW_HOME } from './config.js';

/** Resolved on every call so PROVIDERS_CONFIG_PATH can be set per-test. */
function configPath(): string {
  const envPath = process.env.PROVIDERS_CONFIG_PATH?.trim();
  if (envPath) return path.resolve(envPath);
  return path.join(GRANCLAW_HOME, 'providers.config.json');
}

// ── Data model ────────────────────────────────────────────────────────────────

interface ProviderEntry {
  model: string;
  apiKey: string;
}

interface ProvidersConfig {
  /** New multi-provider format */
  providers?: Record<string, ProviderEntry>;
  /** Legacy single-active format — migrated to `providers` on read */
  active?: { provider: string; model: string; apiKey: string };
  search?: { provider?: string; apiKey: string };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function readConfig(): ProvidersConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as ProvidersConfig;
  } catch {
    return {};
  }
}

/** Returns providers map, transparently migrating from legacy `active` format. */
function getProvidersMap(cfg: ProvidersConfig): Record<string, ProviderEntry> {
  if (cfg.providers) return { ...cfg.providers };
  if (cfg.active) {
    return { [cfg.active.provider]: { model: cfg.active.model, apiKey: cfg.active.apiKey } };
  }
  return {};
}

function writeConfig(cfg: ProvidersConfig, providers: Record<string, ProviderEntry>): void {
  // Always write in the new format — drop legacy `active` field
  const { active: _removed, ...rest } = cfg;
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...rest, providers }, null, 2));
  fs.renameSync(tmp, configPath());
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List all configured providers. Never includes apiKey. */
export function listProviders(): { provider: string; model: string }[] {
  const cfg = readConfig();
  const map = getProvidersMap(cfg);
  return Object.entries(map).map(([provider, entry]) => ({ provider, model: entry.model }));
}

/**
 * Returns { provider, model } for a specific provider, or the first one if no arg.
 * Never returns the apiKey.
 */
export function getProvider(provider?: string): { provider: string; model: string } | null {
  const cfg = readConfig();
  const map = getProvidersMap(cfg);
  if (provider) {
    const entry = map[provider];
    return entry ? { provider, model: entry.model } : null;
  }
  const first = Object.entries(map)[0];
  return first ? { provider: first[0], model: first[1].model } : null;
}

/** Server-side only — returns the raw API key for a specific provider (or first). */
export function getProviderApiKey(provider?: string): string | null {
  const cfg = readConfig();
  const map = getProvidersMap(cfg);
  if (provider) return map[provider]?.apiKey ?? null;
  return Object.values(map)[0]?.apiKey ?? null;
}

/** Upsert a provider entry. */
export function saveProvider(provider: string, model: string, apiKey: string): void {
  const cfg = readConfig();
  const map = getProvidersMap(cfg);
  map[provider] = { model, apiKey };
  writeConfig(cfg, map);
}

/** Remove a specific provider. No-op if not found. */
export function removeProvider(provider: string): void {
  const cfg = readConfig();
  const map = getProvidersMap(cfg);
  delete map[provider];
  writeConfig(cfg, map);
}

/** Remove all provider configs. */
export function clearProvider(): void {
  const cfg = readConfig();
  writeConfig(cfg, {});
}

// ── Search config ─────────────────────────────────────────────────────────────

export interface SearchConfig {
  provider: 'brave';
  apiKey: string;
}

/** Returns the Brave Search API key, or null if not configured. */
export function getSearchApiKey(): string | null {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as { search?: { apiKey?: string } };
    return parsed.search?.apiKey ?? null;
  } catch {
    return null;
  }
}

export function saveSearch(apiKey: string): void {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { /* first write */ }
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...existing, search: { provider: 'brave', apiKey } }, null, 2));
  fs.renameSync(tmp, configPath());
}

export function clearSearch(): void {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return; }
  const { search: _removed, ...rest } = existing;
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rest, null, 2));
  fs.renameSync(tmp, configPath());
}
