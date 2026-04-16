import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getAgentIntegration,
  upsertAgentIntegration,
  setAgentIntegrationActive,
} from './agent-integrations-db.js';
import { closeWorkspaceDb } from '../workspace-pool.js';

function freshWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-agent-int-'));
  return dir;
}

describe('agent-integrations-db', () => {
  let ws: string;
  beforeEach(() => {
    ws = freshWorkspace();
  });

  it('returns null when no row exists', () => {
    expect(getAgentIntegration(ws, 'sample-integration')).toBeNull();
    closeWorkspaceDb(ws);
  });

  it('upserts and reads', () => {
    upsertAgentIntegration(ws, 'sample-integration', { active: true, externalId: 'prof_123' });
    const got = getAgentIntegration(ws, 'sample-integration');
    expect(got).toMatchObject({ integrationId: 'sample-integration', active: true, externalId: 'prof_123' });
    expect(got?.metadata).toEqual({});
    closeWorkspaceDb(ws);
  });

  it('CRITICAL INVARIANT: deactivate preserves externalId, reactivation reuses it', () => {
    upsertAgentIntegration(ws, 'sample-integration', { active: true, externalId: 'prof_xyz' });

    setAgentIntegrationActive(ws, 'sample-integration', false);
    let got = getAgentIntegration(ws, 'sample-integration');
    expect(got?.active).toBe(false);
    expect(got?.externalId).toBe('prof_xyz');

    setAgentIntegrationActive(ws, 'sample-integration', true);
    got = getAgentIntegration(ws, 'sample-integration');
    expect(got?.active).toBe(true);
    expect(got?.externalId).toBe('prof_xyz');

    closeWorkspaceDb(ws);
  });

  it('upsert with null externalId does NOT wipe an existing externalId', () => {
    upsertAgentIntegration(ws, 'sample-integration', { active: true, externalId: 'prof_sticky' });
    upsertAgentIntegration(ws, 'sample-integration', { active: false, externalId: null });
    expect(getAgentIntegration(ws, 'sample-integration')?.externalId).toBe('prof_sticky');
    closeWorkspaceDb(ws);
  });

  it('upsert with new externalId replaces previous one', () => {
    upsertAgentIntegration(ws, 'sample-integration', { active: true, externalId: 'prof_old' });
    upsertAgentIntegration(ws, 'sample-integration', { active: true, externalId: 'prof_new' });
    expect(getAgentIntegration(ws, 'sample-integration')?.externalId).toBe('prof_new');
    closeWorkspaceDb(ws);
  });

  it('stores per-integration rows independently', () => {
    upsertAgentIntegration(ws, 'sample-integration', { active: true, externalId: 'gl_1' });
    upsertAgentIntegration(ws, 'brightdata', { active: false, externalId: 'bd_1' });
    expect(getAgentIntegration(ws, 'sample-integration')?.externalId).toBe('gl_1');
    expect(getAgentIntegration(ws, 'brightdata')?.externalId).toBe('bd_1');
    closeWorkspaceDb(ws);
  });

  it('round-trips metadata', () => {
    upsertAgentIntegration(ws, 'sample-integration', {
      active: true,
      externalId: 'p1',
      metadata: { createdByAgentName: 'Atlas', fingerprint: 'lin' },
    });
    expect(getAgentIntegration(ws, 'sample-integration')?.metadata).toEqual({
      createdByAgentName: 'Atlas',
      fingerprint: 'lin',
    });
    closeWorkspaceDb(ws);
  });
});
