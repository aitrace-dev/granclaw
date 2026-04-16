/**
 * integrations/agent-integrations-db.ts
 *
 * Per-agent (per-workspace) integration activation state. Stored in the
 * workspace's agent.sqlite via getWorkspaceDb() — same file as sessions,
 * jobs, tasks, schedules, secrets.
 *
 * CRITICAL INVARIANT: deactivation must not wipe externalId.
 * Reactivating reuses the same external resource (e.g. a cloud-browser profile).
 * Enforced at three layers:
 *   1. SQL — ON CONFLICT uses COALESCE(excluded.external_id, agent_integrations.external_id)
 *   2. Service — activate() checks for existing externalId before calling provider
 *   3. Test — explicit activate → deactivate → activate → same externalId test
 */

import { getWorkspaceDb } from '../workspace-pool.js';
import { AgentIntegration } from './types.js';

function ensureTable(workspaceDir: string): void {
  getWorkspaceDb(workspaceDir).exec(`
    CREATE TABLE IF NOT EXISTS agent_integrations (
      integration_id TEXT PRIMARY KEY,
      active         INTEGER NOT NULL DEFAULT 0,
      external_id    TEXT,
      metadata       TEXT NOT NULL DEFAULT '{}',
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );
  `);
}

interface Row {
  integration_id: string;
  active: number;
  external_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function toAgentIntegration(row: Row): AgentIntegration {
  return {
    integrationId: row.integration_id,
    active: row.active === 1,
    externalId: row.external_id,
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAgentIntegration(workspaceDir: string, integrationId: string): AgentIntegration | null {
  ensureTable(workspaceDir);
  const row = getWorkspaceDb(workspaceDir)
    .prepare('SELECT * FROM agent_integrations WHERE integration_id = ?')
    .get(integrationId) as Row | undefined;
  return row ? toAgentIntegration(row) : null;
}

export function upsertAgentIntegration(
  workspaceDir: string,
  integrationId: string,
  opts: {
    active: boolean;
    externalId?: string | null;
    metadata?: Record<string, unknown>;
  },
): void {
  ensureTable(workspaceDir);
  getWorkspaceDb(workspaceDir).prepare(`
    INSERT INTO agent_integrations (integration_id, active, external_id, metadata)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(integration_id) DO UPDATE SET
      active = excluded.active,
      external_id = COALESCE(excluded.external_id, agent_integrations.external_id),
      metadata = excluded.metadata,
      updated_at = datetime('now')
  `).run(
    integrationId,
    opts.active ? 1 : 0,
    opts.externalId ?? null,
    JSON.stringify(opts.metadata ?? {}),
  );
}

/** Toggle active flag only. Never touches externalId. */
export function setAgentIntegrationActive(workspaceDir: string, integrationId: string, active: boolean): void {
  ensureTable(workspaceDir);
  getWorkspaceDb(workspaceDir)
    .prepare(`UPDATE agent_integrations SET active = ?, updated_at = datetime('now') WHERE integration_id = ?`)
    .run(active ? 1 : 0, integrationId);
}
