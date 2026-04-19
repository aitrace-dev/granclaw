/**
 * providers-config.test.ts
 *
 * Unit tests for the multi-provider config store.
 *
 * Uses PROVIDERS_CONFIG_PATH env var (read on every function call) to isolate
 * each test to its own temp file — no module reload tricks needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  listProviders,
  getProvider,
  getProviderApiKey,
  getProviderBaseUrl,
  saveProvider,
  removeProvider,
  clearProvider,
  getSearchApiKey,
  saveSearch,
  clearSearch,
} from './providers-config.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-pc-test-'));
  process.env.PROVIDERS_CONFIG_PATH = path.join(tmp, 'providers.config.json');
});

afterEach(() => {
  delete process.env.PROVIDERS_CONFIG_PATH;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeRaw(data: unknown) {
  fs.writeFileSync(process.env.PROVIDERS_CONFIG_PATH!, JSON.stringify(data, null, 2));
}

// ── listProviders ─────────────────────────────────────────────────────────────

describe('listProviders', () => {
  it('returns empty array when no config file', () => {
    expect(listProviders()).toEqual([]);
  });

  it('returns empty array when providers map is empty', () => {
    writeRaw({ providers: {} });
    expect(listProviders()).toEqual([]);
  });

  it('returns one entry after saveProvider', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    const list = listProviders();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ provider: 'google', model: 'gemini-2.5-flash' });
  });

  it('returns multiple entries in insertion order', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openrouter', 'deepseek/deepseek-v3.2', 'key-or');
    const list = listProviders();
    expect(list).toHaveLength(2);
    expect(list.map(p => p.provider)).toEqual(['google', 'openrouter']);
  });

  it('never exposes apiKey', () => {
    saveProvider('google', 'gemini-2.5-flash', 'super-secret');
    const list = listProviders();
    expect(JSON.stringify(list)).not.toContain('super-secret');
  });

  it('migrates legacy active format transparently', () => {
    writeRaw({ active: { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' } });
    const list = listProviders();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });
});

// ── getProvider ───────────────────────────────────────────────────────────────

describe('getProvider', () => {
  it('returns null when nothing configured', () => {
    expect(getProvider()).toBeNull();
    expect(getProvider('google')).toBeNull();
  });

  it('returns first provider when called with no arg', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openrouter', 'deepseek/deepseek-v3.2', 'key-or');
    expect(getProvider()).toEqual({ provider: 'google', model: 'gemini-2.5-flash' });
  });

  it('returns the named provider', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openrouter', 'deepseek/deepseek-v3.2', 'key-or');
    expect(getProvider('openrouter')).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-v3.2' });
  });

  it('returns null for unknown provider name', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    expect(getProvider('anthropic')).toBeNull();
  });
});

// ── getProviderApiKey ─────────────────────────────────────────────────────────

describe('getProviderApiKey', () => {
  it('returns null when nothing configured', () => {
    expect(getProviderApiKey()).toBeNull();
  });

  it('returns first key when called with no arg', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openrouter', 'deepseek/deepseek-v3.2', 'key-or');
    expect(getProviderApiKey()).toBe('key-g');
  });

  it('returns the key for a named provider', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openrouter', 'deepseek/deepseek-v3.2', 'key-or');
    expect(getProviderApiKey('openrouter')).toBe('key-or');
  });

  it('returns null for unknown provider', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    expect(getProviderApiKey('anthropic')).toBeNull();
  });

  it('reads apiKey from migrated legacy format', () => {
    writeRaw({ active: { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' } });
    expect(getProviderApiKey('anthropic')).toBe('sk-ant');
    expect(getProviderApiKey()).toBe('sk-ant');
  });
});

// ── saveProvider ──────────────────────────────────────────────────────────────

describe('saveProvider', () => {
  it('creates config file on first save', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    expect(fs.existsSync(process.env.PROVIDERS_CONFIG_PATH!)).toBe(true);
  });

  it('upserts: second save for same provider updates model and key', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-old');
    saveProvider('google', 'gemini-2.5-pro', 'key-new');
    expect(listProviders()).toHaveLength(1);
    expect(getProvider('google')).toEqual({ provider: 'google', model: 'gemini-2.5-pro' });
    expect(getProviderApiKey('google')).toBe('key-new');
  });

  it('preserves existing providers when adding a new one', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openai', 'gpt-4.1', 'key-oai');
    expect(listProviders()).toHaveLength(2);
    expect(getProviderApiKey('google')).toBe('key-g');
  });

  it('migrates legacy active format and writes new format', () => {
    writeRaw({ active: { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' } });
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    // Legacy `active` field should be gone
    const raw = JSON.parse(fs.readFileSync(process.env.PROVIDERS_CONFIG_PATH!, 'utf8'));
    expect(raw.active).toBeUndefined();
    expect(raw.providers).toBeDefined();
    expect(Object.keys(raw.providers)).toContain('anthropic');
    expect(Object.keys(raw.providers)).toContain('google');
  });

  it('preserves search config across provider saves', () => {
    saveSearch('brave-key');
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    expect(getSearchApiKey()).toBe('brave-key');
  });
});

// ── removeProvider ────────────────────────────────────────────────────────────

describe('removeProvider', () => {
  it('removes a specific provider', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openrouter', 'deepseek/deepseek-v3.2', 'key-or');
    removeProvider('google');
    const list = listProviders();
    expect(list).toHaveLength(1);
    expect(list[0].provider).toBe('openrouter');
  });

  it('is a no-op when provider does not exist', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    removeProvider('anthropic'); // not configured
    expect(listProviders()).toHaveLength(1);
  });

  it('preserves search config after remove', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveSearch('brave-key');
    removeProvider('google');
    expect(getSearchApiKey()).toBe('brave-key');
  });
});

// ── clearProvider ─────────────────────────────────────────────────────────────

describe('clearProvider', () => {
  it('removes all providers', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveProvider('openrouter', 'deepseek/deepseek-v3.2', 'key-or');
    clearProvider();
    expect(listProviders()).toEqual([]);
    expect(getProvider()).toBeNull();
  });

  it('preserves search config after clear', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveSearch('brave-key');
    clearProvider();
    expect(getSearchApiKey()).toBe('brave-key');
  });
});

// ── search config ─────────────────────────────────────────────────────────────

describe('search config', () => {
  it('returns null when no search config', () => {
    expect(getSearchApiKey()).toBeNull();
  });

  it('saves and retrieves a search key', () => {
    saveSearch('brave-key-123');
    expect(getSearchApiKey()).toBe('brave-key-123');
  });

  it('overwrites previous search key', () => {
    saveSearch('key-old');
    saveSearch('key-new');
    expect(getSearchApiKey()).toBe('key-new');
  });

  it('clearSearch removes the key', () => {
    saveSearch('brave-key');
    clearSearch();
    expect(getSearchApiKey()).toBeNull();
  });

  it('clearSearch does not touch providers', () => {
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    saveSearch('brave-key');
    clearSearch();
    expect(listProviders()).toHaveLength(1);
    expect(getProviderApiKey('google')).toBe('key-g');
  });
});

// ── migration ─────────────────────────────────────────────────────────────────

describe('legacy active format migration', () => {
  it('reads providers from active field without modifying the file', () => {
    writeRaw({ active: { provider: 'openrouter', model: 'deepseek/deepseek-v3.2', apiKey: 'sk-or' } });
    const list = listProviders();
    expect(list).toHaveLength(1);
    expect(list[0].provider).toBe('openrouter');
    // File should still be in old format (migration is read-only)
    const raw = JSON.parse(fs.readFileSync(process.env.PROVIDERS_CONFIG_PATH!, 'utf8'));
    expect(raw.active).toBeDefined();
  });

  it('writes new format and drops active field on first mutation', () => {
    writeRaw({ active: { provider: 'openrouter', model: 'deepseek/deepseek-v3.2', apiKey: 'sk-or' } });
    saveProvider('google', 'gemini-2.5-flash', 'key-g');
    const raw = JSON.parse(fs.readFileSync(process.env.PROVIDERS_CONFIG_PATH!, 'utf8'));
    expect(raw.active).toBeUndefined();
    expect(raw.providers.openrouter).toBeDefined();
    expect(raw.providers.google).toBeDefined();
  });
});

// ── managed provider config ───────────────────────────────────────────────────

describe('managed provider config', () => {
  let managedConfigPath: string;

  beforeEach(() => {
    managedConfigPath = path.join(tmp, 'config-provider.json');
    // Remove managed config if present from a previous test
    try { fs.unlinkSync(managedConfigPath); } catch { /* ok */ }
    process.env.MANAGED_CONFIG_PATH = managedConfigPath;
  });

  afterEach(() => {
    delete process.env.MANAGED_CONFIG_PATH;
    try { fs.unlinkSync(managedConfigPath); } catch { /* ok */ }
  });

  it('returns no managed providers when config file is absent', () => {
    const providers = listProviders();
    // File doesn't exist — should not throw, returns only user providers (none configured)
    expect(providers.filter(p => p.managed)).toHaveLength(0);
  });

  it('prepends managed provider first when config-provider.json is present', () => {
    fs.writeFileSync(managedConfigPath, JSON.stringify({
      llm: {
        provider: 'openrouter',
        apiKey: 'gck_usr_testuser',
        baseUrl: 'http://proxy:4002/v1',
        defaultModel: 'z-ai/glm-5-turbo',
        label: 'Free Tier',
      },
    }));
    const providers = listProviders();
    expect(providers[0]).toMatchObject({
      provider: 'openrouter',
      model: 'z-ai/glm-5-turbo',
      managed: true,
      label: 'Free Tier',
      baseUrl: 'http://proxy:4002/v1',
    });
  });

  it('getProviderApiKey falls back to managed key when no user provider matches', () => {
    fs.writeFileSync(managedConfigPath, JSON.stringify({
      llm: {
        provider: 'openrouter',
        apiKey: 'gck_usr_testuser',
        baseUrl: 'http://proxy:4002/v1',
        defaultModel: 'z-ai/glm-5-turbo',
        label: 'Free Tier',
      },
    }));
    const key = getProviderApiKey('openrouter');
    expect(key).toBe('gck_usr_testuser');
  });

  it('getProviderApiKey returns managed key when no user providers exist', () => {
    fs.writeFileSync(managedConfigPath, JSON.stringify({
      llm: {
        provider: 'openrouter',
        apiKey: 'gck_usr_fallback',
        defaultModel: 'z-ai/glm-5-turbo',
        label: 'Free Tier',
      },
    }));
    const key = getProviderApiKey(); // no arg — should fall back to managed
    expect(key).toBe('gck_usr_fallback');
  });

  it('getProviderBaseUrl returns null when no managed config', () => {
    expect(getProviderBaseUrl()).toBeNull();
  });

  it('getProviderBaseUrl returns baseUrl from managed config', () => {
    fs.writeFileSync(managedConfigPath, JSON.stringify({
      llm: {
        provider: 'openrouter',
        apiKey: 'gck_usr_testuser',
        baseUrl: 'http://proxy:4002/v1',
        defaultModel: 'z-ai/glm-5-turbo',
        label: 'Free Tier',
      },
    }));
    expect(getProviderBaseUrl()).toBe('http://proxy:4002/v1');
  });

  it('getProviderBaseUrl returns null when provider arg does not match managed provider', () => {
    fs.writeFileSync(managedConfigPath, JSON.stringify({
      llm: {
        provider: 'openrouter',
        apiKey: 'gck_usr_testuser',
        baseUrl: 'http://proxy:4002/v1',
        defaultModel: 'z-ai/glm-5-turbo',
        label: 'Free Tier',
      },
    }));
    expect(getProviderBaseUrl('anthropic')).toBeNull();
  });
});
