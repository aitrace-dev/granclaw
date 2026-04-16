import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  ensureProfile, activate, deactivate, getActiveProfile, isEnabled, bootstrapIntegration,
} from './service.js';
import { getIntegration } from '../registry.js';
import {
  setAppSecret,
  deleteAppSecret,
  _resetForTests as resetAppSecrets,
} from '../../app-secrets.js';
import { setIntegration, _resetForTests as resetRegistry } from '../registry.js';
import { closeWorkspaceDb } from '../../workspace-pool.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function freshWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-gl-ws-'));
}

describe('gologin service', () => {
  let ws: string;

  beforeEach(() => {
    process.env.GRANCLAW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-gl-'));
    process.env.GRANCLAW_SECRET_KEY = '0'.repeat(64);
    delete process.env.GOLOGIN_API_TOKEN;
    resetAppSecrets();
    resetRegistry();
    ws = freshWorkspace();
    fetchMock.mockReset();
  });

  describe('isEnabled', () => {
    it('returns false when token missing', () => {
      setIntegration('gologin', { enabled: true, config: {} });
      expect(isEnabled()).toBe(false);
    });

    it('returns false when integration disabled in registry', () => {
      setAppSecret('GOLOGIN_API_TOKEN', 'tok123');
      setIntegration('gologin', { enabled: false, config: {} });
      expect(isEnabled()).toBe(false);
    });

    it('returns true when both set', () => {
      setAppSecret('GOLOGIN_API_TOKEN', 'tok123');
      setIntegration('gologin', { enabled: true, config: {} });
      expect(isEnabled()).toBe(true);
    });

    it('env var alone satisfies the token requirement', () => {
      process.env.GOLOGIN_API_TOKEN = 'tok_from_env';
      setIntegration('gologin', { enabled: true, config: {} });
      expect(isEnabled()).toBe(true);
    });

    it('env var takes precedence over app-secret', async () => {
      process.env.GOLOGIN_API_TOKEN = 'tok_env_wins';
      setAppSecret('GOLOGIN_API_TOKEN', 'tok_secret_loses');
      setIntegration('gologin', { enabled: true, config: {} });

      fetchMock.mockResolvedValueOnce({
        ok: true, status: 200, json: async () => ({ id: 'p', name: 'x' }),
      });
      await ensureProfile(ws, 'agent1', 'Atlas');

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_env_wins');
      closeWorkspaceDb(ws);
    });
  });

  describe('bootstrapIntegration', () => {
    it('no-op when env var not set', () => {
      bootstrapIntegration();
      expect(getIntegration('gologin')).toBeNull();
    });

    it('creates enabled row when env var set and no existing row', () => {
      process.env.GOLOGIN_API_TOKEN = 'tok';
      bootstrapIntegration();
      const row = getIntegration('gologin');
      expect(row?.enabled).toBe(true);
    });

    it('does not overwrite an existing disabled row (operator intent wins)', () => {
      process.env.GOLOGIN_API_TOKEN = 'tok';
      setIntegration('gologin', { enabled: false, config: {} });
      bootstrapIntegration();
      expect(getIntegration('gologin')?.enabled).toBe(false);
    });

    it('does not overwrite an existing enabled row (idempotent)', () => {
      process.env.GOLOGIN_API_TOKEN = 'tok';
      setIntegration('gologin', { enabled: true, config: { defaultProxy: 'us' } });
      bootstrapIntegration();
      expect(getIntegration('gologin')?.config).toEqual({ defaultProxy: 'us' });
    });
  });

  describe('ensureProfile', () => {
    beforeEach(() => {
      setAppSecret('GOLOGIN_API_TOKEN', 'tok_abc');
      setIntegration('gologin', { enabled: true, config: {} });
    });

    it('creates profile via GoLogin API on first call', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'prof_new', name: 'granclaw-agent1-Atlas' }),
      });

      const id = await ensureProfile(ws, 'agent1', 'Atlas');

      expect(id).toBe('prof_new');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.gologin.com/browser/quick');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_abc');
      closeWorkspaceDb(ws);
    });

    it('reuses stored profile ID on subsequent calls (no API call)', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'prof_cached', name: 'x' }),
      });
      await ensureProfile(ws, 'agent1', 'Atlas');
      fetchMock.mockReset();

      const id = await ensureProfile(ws, 'agent1', 'Atlas');

      expect(id).toBe('prof_cached');
      expect(fetchMock).not.toHaveBeenCalled();
      closeWorkspaceDb(ws);
    });

    it('throws on GoLogin API error', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });
      await expect(ensureProfile(ws, 'agent1', 'Atlas')).rejects.toThrow(/401/);
      closeWorkspaceDb(ws);
    });
  });

  describe('activate / deactivate / reactivate', () => {
    beforeEach(() => {
      setAppSecret('GOLOGIN_API_TOKEN', 'tok_abc');
      setIntegration('gologin', { enabled: true, config: {} });
    });

    it('activate creates profile and sets active=true', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'prof_1', name: 'x' }),
      });
      const id = await activate(ws, 'agent1', 'Atlas');
      expect(id).toBe('prof_1');
      const profile = getActiveProfile(ws, 'agent1');
      expect(profile).toEqual({ profileId: 'prof_1', token: 'tok_abc' });
      closeWorkspaceDb(ws);
    });

    it('deactivate sets active=false but preserves externalId', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'prof_1', name: 'x' }),
      });
      await activate(ws, 'agent1', 'Atlas');
      deactivate(ws, 'agent1');
      expect(getActiveProfile(ws, 'agent1')).toBeNull();
      closeWorkspaceDb(ws);
    });

    it('CRITICAL: reactivate reuses same profile — no second API call', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'prof_persist', name: 'x' }),
      });
      await activate(ws, 'agent1', 'Atlas');
      deactivate(ws, 'agent1');
      fetchMock.mockReset();

      const id = await activate(ws, 'agent1', 'Atlas');

      expect(id).toBe('prof_persist');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getActiveProfile(ws, 'agent1')?.profileId).toBe('prof_persist');
      closeWorkspaceDb(ws);
    });

    it('activate throws when integration not globally enabled', async () => {
      setIntegration('gologin', { enabled: false, config: {} });
      await expect(activate(ws, 'agent1', 'Atlas')).rejects.toThrow(/not enabled/);
      closeWorkspaceDb(ws);
    });

    it('activate throws when token missing', async () => {
      deleteAppSecret('GOLOGIN_API_TOKEN');
      await expect(activate(ws, 'agent1', 'Atlas')).rejects.toThrow(/not enabled/);
      closeWorkspaceDb(ws);
    });
  });

  describe('getActiveProfile', () => {
    it('returns null when token missing even if DB has an active row', async () => {
      // Set up active state with token...
      setAppSecret('GOLOGIN_API_TOKEN', 'tok_abc');
      setIntegration('gologin', { enabled: true, config: {} });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'p', name: 'x' }),
      });
      await activate(ws, 'agent1', 'Atlas');
      // ...then remove the token — getActiveProfile should now refuse
      deleteAppSecret('GOLOGIN_API_TOKEN');
      expect(getActiveProfile(ws, 'agent1')).toBeNull();
      closeWorkspaceDb(ws);
    });
  });
});
