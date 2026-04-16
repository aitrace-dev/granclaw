/**
 * integrations/gologin/routes.ts
 *
 * Per-agent GoLogin activation endpoints. Mounted under /integrations/gologin
 * by integrations/routes.ts.
 *
 * All routes resolve the target agent via config.getAgent(id) → workspaceDir,
 * then delegate to service.ts. Route handlers own nothing but validation and
 * HTTP translation.
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import { getAgent, resolveGranclawHome } from '../../config.js';
import { activate, deactivate, isEnabled, INTEGRATION_ID } from './service.js';
import { getAgentIntegration } from '../agent-integrations-db.js';

export const gologinRouter = Router();

function workspaceFor(agentId: string): { workspaceDir: string; name: string } | null {
  const agent = getAgent(agentId);
  if (!agent) return null;
  return {
    workspaceDir: path.resolve(resolveGranclawHome(), agent.workspaceDir),
    name: agent.name,
  };
}

gologinRouter.post('/agents/:agentId/activate', async (req: Request, res: Response) => {
  try {
    if (!isEnabled()) {
      res.status(409).json({ error: 'gologin integration not enabled' });
      return;
    }
    const resolved = workspaceFor(req.params.agentId);
    if (!resolved) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    const profileId = await activate(resolved.workspaceDir, req.params.agentId, resolved.name);
    res.json({ active: true, profileId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

gologinRouter.post('/agents/:agentId/deactivate', (req: Request, res: Response) => {
  try {
    const resolved = workspaceFor(req.params.agentId);
    if (!resolved) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }
    deactivate(resolved.workspaceDir, req.params.agentId);
    // Read the persisted externalId so the client can display
    // "Inactive (profile: prof_xyz)" without extra calls.
    const row = getAgentIntegration(resolved.workspaceDir, INTEGRATION_ID);
    res.json({ active: false, profileId: row?.externalId ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

gologinRouter.get('/agents/:agentId/status', (req: Request, res: Response) => {
  const resolved = workspaceFor(req.params.agentId);
  if (!resolved) {
    res.status(404).json({ error: 'agent not found' });
    return;
  }
  const row = getAgentIntegration(resolved.workspaceDir, INTEGRATION_ID);
  res.json({
    active: row?.active ?? false,
    profileId: row?.externalId ?? null,
    enabled: isEnabled(),
  });
});
