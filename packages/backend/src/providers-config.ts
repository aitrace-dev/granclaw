// packages/backend/src/providers-config.ts
import fs from 'fs';
import path from 'path';
import { GRANCLAW_HOME } from './config.js';

const MANAGED_CONFIG_PATH = path.join(GRANCLAW_HOME, 'config-provider.json');

interface ManagedProviderConfig {
  llm?: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
    defaultModel: string;
    label: string;
  };
  search?: {
    provider: string;
    apiKey?: string;
    label: string;
  };
}

function readManagedConfig(): ManagedProviderConfig {
  try {
    const envPath = process.env.MANAGED_CONFIG_PATH?.trim();
    const p = envPath ? path.resolve(envPath) : MANAGED_CONFIG_PATH;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ManagedProviderConfig;
  } catch {
    return {};
  }
}

/** Resolved on every call so PROVIDERS_CONFIG_PATH can be set per-test. */
function configPath(): string {
  const envPath = process.env.PROVIDERS_CONFIG_PATH?.trim();
  if (envPath) return path.resolve(envPath);
  return path.join(GRANCLAW_HOME, 'providers.config.json');
}

// ── Data model ────────────────────────────────────────────────────────────────

export interface PublicProviderEntry {
  provider: string;
  model: string;
  managed?: boolean;
  label?: string;
  baseUrl?: string;
}

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

/** List all configured providers (managed from config-provider.json + user-configured). Never includes apiKey. */
export function listProviders(): PublicProviderEntry[] {
  const cfg = readConfig();
  const map = getProvidersMap(cfg);
  const userProviders: PublicProviderEntry[] = Object.entries(map).map(([provider, entry]) => ({
    provider,
    model: entry.model,
  }));

  const managed = readManagedConfig();
  const managedProviders: PublicProviderEntry[] = [];
  if (managed.llm) {
    managedProviders.push({
      provider: managed.llm.provider,
      model: managed.llm.defaultModel,
      managed: true,
      label: managed.llm.label,
      ...(managed.llm.baseUrl ? { baseUrl: managed.llm.baseUrl } : {}),
    });
  }

  return [...managedProviders, ...userProviders];
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
    if (entry) return { provider, model: entry.model };
    // Fall back to managed config (e.g. "freetier" provider seeded by enterprise control)
    const managed = readManagedConfig();
    if (managed.llm?.provider === provider) return { provider, model: managed.llm.defaultModel };
    return null;
  }
  // No provider specified: prefer user-configured, fall back to managed
  const first = Object.entries(map)[0];
  if (first) return { provider: first[0], model: first[1].model };
  const managed = readManagedConfig();
  if (managed.llm) return { provider: managed.llm.provider, model: managed.llm.defaultModel };
  return null;
}

/** Server-side only — returns the raw API key for a specific provider (or first). */
export function getProviderApiKey(provider?: string): string | null {
  const cfg = readConfig();
  const map = getProvidersMap(cfg);
  if (provider) {
    if (map[provider]) return map[provider].apiKey;
    // Fall back to managed config
    const managed = readManagedConfig();
    if (managed.llm?.provider === provider) return managed.llm.apiKey;
    return null;
  }
  // No provider specified: prefer user-configured, fall back to managed
  const first = Object.values(map)[0];
  if (first) return first.apiKey;
  const managed = readManagedConfig();
  return managed.llm?.apiKey ?? null;
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

/** Returns the baseUrl override for a provider if set in the managed config (e.g. enterprise proxy URL). */
export function getProviderBaseUrl(provider?: string): string | null {
  const managed = readManagedConfig();
  if (!managed.llm) return null;
  if (provider && managed.llm.provider !== provider) return null;
  return managed.llm.baseUrl ?? null;
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
