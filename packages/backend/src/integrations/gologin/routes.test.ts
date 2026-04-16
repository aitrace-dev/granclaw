import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Mocks ─────────────────────────────────────────────────────────────────
// Mock config.getAgent before the routes module imports it. We also keep
// resolveGranclawHome pass-through so app-secrets + workspace resolution work.
vi.mock('../../config.js', async () => {
  const actual = await vi.importActual<typeof import('../../config.js')>('../../config.js');
  return {
    ...actual,
    getAgent: vi.fn(),
  };
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// Imports AFTER vi.mock so the mock takes effect
import { getAgent } from '../../config.js';
import { integrationsRouter } from '../routes.js';
import { setAppSecret, deleteAppSecret, _resetForTests as resetAppSecrets } from '../../app-secrets.js';
import { setIntegration, _resetForTests as resetRegistry } from '../registry.js';
import { closeWorkspaceDb } from '../../workspace-pool.js';

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/integrations', integrationsRouter);
  return app;
}

describe('GoLogin routes', () => {
  let ws: string;

  beforeEach(() => {
    process.env.GRANCLAW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-rt-home-'));
    process.env.GRANCLAW_SECRET_KEY = '0'.repeat(64);
    resetAppSecrets();
    resetRegistry();
    setAppSecret('GOLOGIN_API_TOKEN', 'tok_abc');
    setIntegration('gologin', { enabled: true, config: {} });
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-rt-ws-'));
    (getAgent as any).mockReset();
    (getAgent as any).mockImplementation((id: string) => {
      if (id === 'agent1') return { id: 'agent1', name: 'Atlas', workspaceDir: ws, model: 'x', allowedTools: [] };
      return undefined;
    });
    fetchMock.mockReset();
  });

  it('POST /agents/:id/activate returns 200 with new profileId', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ id: 'prof_1', name: 'x' }),
    });

    const res = await request(makeApp()).post('/integrations/gologin/agents/agent1/activate');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: true, profileId: 'prof_1' });
    closeWorkspaceDb(ws);
  });

  it('POST /agents/:id/activate returns 409 when integration not enabled', async () => {
    setIntegration('gologin', { enabled: false, config: {} });

    const res = await request(makeApp()).post('/integrations/gologin/agents/agent1/activate');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not enabled/);
    closeWorkspaceDb(ws);
  });

  it('POST /agents/:id/activate returns 404 when agent not found', async () => {
    const res = await request(makeApp()).post('/integrations/gologin/agents/nope/activate');
    expect(res.status).toBe(404);
  });

  it('POST /agents/:id/deactivate preserves profileId in response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ id: 'prof_1', name: 'x' }),
    });
    await request(makeApp()).post('/integrations/gologin/agents/agent1/activate');

    const res = await request(makeApp()).post('/integrations/gologin/agents/agent1/deactivate');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false, profileId: 'prof_1' });
    closeWorkspaceDb(ws);
  });

  it('GET /agents/:id/status reflects current state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ id: 'prof_1', name: 'x' }),
    });
    await request(makeApp()).post('/integrations/gologin/agents/agent1/activate');

    const res = await request(makeApp()).get('/integrations/gologin/agents/agent1/status');

    expect(res.body).toEqual({ active: true, profileId: 'prof_1', enabled: true });
    closeWorkspaceDb(ws);
  });

  it('GET /agents/:id/status returns enabled=false when token missing', async () => {
    deleteAppSecret('GOLOGIN_API_TOKEN');

    const res = await request(makeApp()).get('/integrations/gologin/agents/agent1/status');

    expect(res.body.enabled).toBe(false);
    closeWorkspaceDb(ws);
  });

  it('CRITICAL: activate → deactivate → activate reuses same profile (no second API call)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ id: 'prof_sticky', name: 'x' }),
    });

    await request(makeApp()).post('/integrations/gologin/agents/agent1/activate');
    await request(makeApp()).post('/integrations/gologin/agents/agent1/deactivate');
    fetchMock.mockReset();
    const res = await request(makeApp()).post('/integrations/gologin/agents/agent1/activate');

    expect(res.body.profileId).toBe('prof_sticky');
    expect(fetchMock).not.toHaveBeenCalled();
    closeWorkspaceDb(ws);
  });
});

describe('Integrations root + secrets routes', () => {
  beforeEach(() => {
    process.env.GRANCLAW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-gen-'));
    process.env.GRANCLAW_SECRET_KEY = '0'.repeat(64);
    resetAppSecrets();
    resetRegistry();
  });

  it('GET / returns empty list initially', async () => {
    const res = await request(makeApp()).get('/integrations');
    expect(res.body).toEqual({ integrations: [] });
  });

  it('PUT /:id + GET /:id round-trips config', async () => {
    await request(makeApp())
      .put('/integrations/gologin')
      .send({ enabled: true, config: { defaultProxy: 'us' } })
      .expect(204);

    const res = await request(makeApp()).get('/integrations/gologin');
    expect(res.body).toMatchObject({ id: 'gologin', enabled: true, config: { defaultProxy: 'us' } });
  });

  it('PUT /:id/secret/:name stores under uppercased compound key', async () => {
    await request(makeApp())
      .put('/integrations/gologin/secret/api_token')
      .send({ value: 'tok_xyz' })
      .expect(204);

    const exists = await request(makeApp()).get('/integrations/gologin/secret/api_token/exists');
    expect(exists.body).toEqual({ exists: true });
  });

  it('PUT /:id/secret/:name requires value in body', async () => {
    const res = await request(makeApp())
      .put('/integrations/gologin/secret/api_token')
      .send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /:id/secret/:name removes it', async () => {
    await request(makeApp())
      .put('/integrations/gologin/secret/api_token')
      .send({ value: 'v' })
      .expect(204);

    await request(makeApp()).delete('/integrations/gologin/secret/api_token').expect(204);

    const exists = await request(makeApp()).get('/integrations/gologin/secret/api_token/exists');
    expect(exists.body).toEqual({ exists: false });
  });
});
