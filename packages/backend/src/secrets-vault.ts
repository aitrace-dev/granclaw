/**
 * secrets-vault.ts
 *
 * Per-agent secrets store.
 * Backed by <workspaceDir>/agent.sqlite via getWorkspaceDb().
 */

import { getWorkspaceDb } from './workspace-pool.js';

export function listSecretNames(workspaceDir: string): string[] {
  return (getWorkspaceDb(workspaceDir).prepare(
    `SELECT name FROM secrets ORDER BY created_at`
  ).all() as { name: string }[]).map((r) => r.name);
}

export function getSecrets(workspaceDir: string): Record<string, string> {
  const rows = getWorkspaceDb(workspaceDir).prepare(
    `SELECT name, value FROM secrets`
  ).all() as { name: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.name, r.value]));
}

export function setSecret(workspaceDir: string, name: string, value: string): void {
  getWorkspaceDb(workspaceDir).prepare(`
    INSERT INTO secrets (name, value) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value
  `).run(name, value);
}

export function deleteSecret(workspaceDir: string, name: string): void {
  getWorkspaceDb(workspaceDir).prepare(
    `DELETE FROM secrets WHERE name = ?`
  ).run(name);
}

export function deleteAllSecrets(workspaceDir: string): void {
  getWorkspaceDb(workspaceDir).prepare(`DELETE FROM secrets`).run();
}
