/**
 * integrations/gologin/service.ts
 *
 * GoLogin API client + per-agent activation lifecycle.
 *
 * The key contract (see plan doc Layer 4): on activation, if an externalId
 * (GoLogin profile ID) is already stored for this agent, reuse it — never
 * create a new profile. Deactivation only toggles the active flag; the
 * profile ID persists so reactivation is free and idempotent.
 *
 * Scope note: token never hits an agent workspace DB. It's read from
 * app-secrets (granclaw-root) via getAppSecret().
 */

import { getAppSecret } from '../../app-secrets.js';
import { getIntegration, setIntegration } from '../registry.js';
import {
  getAgentIntegration,
  upsertAgentIntegration,
  setAgentIntegrationActive,
} from '../agent-integrations-db.js';

export const INTEGRATION_ID = 'gologin';
export const TOKEN_KEY = 'GOLOGIN_API_TOKEN';
const API_BASE = 'https://api.gologin.com';

/**
 * Resolve the GoLogin token.
 *
 * Priority:
 *   1. GOLOGIN_API_TOKEN env var — set by enterprise container provisioning.
 *      Preferred because it's ephemeral and isn't persisted in the tenant DB.
 *   2. app-secrets store — for local dev, configured via PUT /integrations/gologin/secret/api_token.
 */
function getToken(): string | null {
  const envToken = process.env.GOLOGIN_API_TOKEN?.trim();
  if (envToken) return envToken;
  return getAppSecret(TOKEN_KEY);
}

export function isEnabled(): boolean {
  const integration = getIntegration(INTEGRATION_ID);
  if (!integration?.enabled) return false;
  return getToken() !== null;
}

/**
 * One-time bootstrap. Called at orchestrator startup. If the env var is set
 * AND no integration row exists yet, create one with enabled=true so the
 * tenant container comes up with GoLogin already "on" — the admin doesn't
 * need a post-provision curl to flip the flag.
 *
 * Idempotent: if a row already exists (even with enabled=false, e.g. the user
 * manually disabled), we don't touch it. Operator intent wins.
 */
export function bootstrapIntegration(): void {
  const envToken = process.env.GOLOGIN_API_TOKEN?.trim();
  if (!envToken) return;
  const existing = getIntegration(INTEGRATION_ID);
  if (existing) return;
  setIntegration(INTEGRATION_ID, { enabled: true, config: {} });
}

async function callGoLogin(pathname: string, init: RequestInit): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error('GoLogin token not configured');
  const res = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GoLogin API ${init.method ?? 'GET'} ${pathname} failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Return this agent's GoLogin profile ID, creating one if none exists.
 * Idempotent: callers can invoke repeatedly without worrying about profile churn.
 */
export async function ensureProfile(workspaceDir: string, agentId: string, agentName: string): Promise<string> {
  const existing = getAgentIntegration(workspaceDir, INTEGRATION_ID);
  if (existing?.externalId) return existing.externalId;

  const profile = await callGoLogin('/browser/quick', {
    method: 'POST',
    body: JSON.stringify({
      os: 'lin',
      name: `granclaw-${agentId}-${agentName}`.slice(0, 100),
    }),
  }) as { id: string; name: string };

  upsertAgentIntegration(workspaceDir, INTEGRATION_ID, {
    active: true,
    externalId: profile.id,
    metadata: { createdByAgentName: agentName },
  });
  return profile.id;
}

/**
 * Activate GoLogin for an agent. If a profile already exists, reuse it —
 * never create a duplicate. If not, create one via the API.
 */
export async function activate(workspaceDir: string, agentId: string, agentName: string): Promise<string> {
  if (!isEnabled()) throw new Error('GoLogin integration not enabled');
  const existing = getAgentIntegration(workspaceDir, INTEGRATION_ID);
  if (existing?.externalId) {
    setAgentIntegrationActive(workspaceDir, INTEGRATION_ID, true);
    return existing.externalId;
  }
  return ensureProfile(workspaceDir, agentId, agentName);
}

/**
 * Deactivate GoLogin for an agent. Only flips active=false — never deletes
 * the profile or clears external_id, so reactivation reuses the same profile.
 */
export function deactivate(workspaceDir: string, _agentId: string): void {
  setAgentIntegrationActive(workspaceDir, INTEGRATION_ID, false);
}

/**
 * Resolve the active profile + token for an agent.
 * Returns null unless:
 *   - Integration globally enabled
 *   - Token configured
 *   - Agent row has active=true AND externalId set
 *
 * Called by the browser tool factory to decide which CLI binary to run.
 */
export function getActiveProfile(workspaceDir: string, _agentId: string): { profileId: string; token: string } | null {
  const token = getToken();
  if (!token) return null;
  const row = getAgentIntegration(workspaceDir, INTEGRATION_ID);
  if (!row?.active || !row.externalId) return null;
  return { profileId: row.externalId, token };
}
