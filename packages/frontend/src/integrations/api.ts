/**
 * integrations/api.ts — REST wrappers for the Integrations API.
 */

const BASE = '';

export interface GoLoginStatus {
  active: boolean;
  profileId: string | null;
  enabled: boolean;
}

export interface GoLoginActivateResult {
  active: boolean;
  profileId: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchGoLoginStatus(agentId: string): Promise<GoLoginStatus> {
  return handle(await fetch(`${BASE}/integrations/gologin/agents/${encodeURIComponent(agentId)}/status`));
}

export async function activateGoLogin(agentId: string): Promise<GoLoginActivateResult> {
  return handle(await fetch(`${BASE}/integrations/gologin/agents/${encodeURIComponent(agentId)}/activate`, {
    method: 'POST',
  }));
}

export async function deactivateGoLogin(agentId: string): Promise<GoLoginActivateResult> {
  return handle(await fetch(`${BASE}/integrations/gologin/agents/${encodeURIComponent(agentId)}/deactivate`, {
    method: 'POST',
  }));
}
