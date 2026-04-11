/**
 * secrets-vault.ts
 *
 * Per-agent secrets store.
 * Backed by data/system.sqlite (shared global DB via getDataDb()).
 */

import { getDataDb } from './data-db.js';

export function listSecretNames(agentId: string): string[] {
  return (getDataDb().prepare(
    `SELECT name FROM secrets WHERE agent_id = ? ORDER BY created_at`
  ).all(agentId) as { name: string }[]).map((r) => r.name);
}

export function getSecrets(agentId: string): Record<string, string> {
  const rows = getDataDb().prepare(
    `SELECT name, value FROM secrets WHERE agent_id = ?`
  ).all(agentId) as { name: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

export function setSecret(agentId: string, name: string, value: string): void {
  getDataDb().prepare(`
    INSERT INTO secrets (agent_id, name, value) VALUES (?, ?, ?)
    ON CONFLICT(agent_id, name) DO UPDATE SET value = excluded.value
  `).run(agentId, name, value);
}

export function deleteSecret(agentId: string, name: string): void {
  getDataDb().prepare(
    `DELETE FROM secrets WHERE agent_id = ? AND name = ?`
  ).run(agentId, name);
}

export function deleteAllSecrets(agentId: string): void {
  getDataDb().prepare(`DELETE FROM secrets WHERE agent_id = ?`).run(agentId);
}
