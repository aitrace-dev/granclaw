/**
 * integrations/routes.ts
 *
 * Integration framework routes mounted at /integrations.
 *
 * General endpoints (list/configure integrations, secret storage) live here.
 * Integration-specific routes mount under sub-paths (e.g. /integrations/gologin).
 */

import { Router, Request, Response } from 'express';
import { listIntegrations, getIntegration, setIntegration } from './registry.js';
import { setAppSecret, hasAppSecret, deleteAppSecret } from '../app-secrets.js';
import { gologinRouter } from './gologin/routes.js';

export const integrationsRouter = Router();

integrationsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ integrations: listIntegrations() });
});

integrationsRouter.get('/:id', (req: Request, res: Response) => {
  const integration = getIntegration(req.params.id);
  if (!integration) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(integration);
});

integrationsRouter.put('/:id', (req: Request, res: Response) => {
  const { enabled, config } = req.body as { enabled?: boolean; config?: Record<string, unknown> };
  setIntegration(req.params.id, { enabled: !!enabled, config: config ?? {} });
  res.status(204).end();
});

/** Set an integration secret. Key format: {INTEGRATION_ID}_{NAME} (upper-cased). */
integrationsRouter.put('/:id/secret/:name', (req: Request, res: Response) => {
  const { value } = req.body as { value?: string };
  if (!value) {
    res.status(400).json({ error: 'value required' });
    return;
  }
  const key = `${req.params.id.toUpperCase()}_${req.params.name.toUpperCase()}`;
  setAppSecret(key, value);
  res.status(204).end();
});

integrationsRouter.get('/:id/secret/:name/exists', (req: Request, res: Response) => {
  const key = `${req.params.id.toUpperCase()}_${req.params.name.toUpperCase()}`;
  res.json({ exists: hasAppSecret(key) });
});

integrationsRouter.delete('/:id/secret/:name', (req: Request, res: Response) => {
  const key = `${req.params.id.toUpperCase()}_${req.params.name.toUpperCase()}`;
  deleteAppSecret(key);
  res.status(204).end();
});

integrationsRouter.use('/gologin', gologinRouter);
