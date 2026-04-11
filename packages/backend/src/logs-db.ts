/**
 * logs-db.ts
 *
 * Shared audit log for all agents.
 * Backed by data/system.sqlite (shared global DB via getDataDb()).
 */

import { randomUUID } from 'crypto';
import { getDataDb } from './data-db.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActionRow {
  id: string;
  agent_id: string;
  type: string;
  input: string | null;
  output: string | null;
  duration_ms: number | null;
  created_at: number;
}

export type ActionType = 'message' | 'tool_call' | 'tool_result' | 'error' | 'system';

// ── Writes ────────────────────────────────────────────────────────────────────

export function logAction(
  agentId: string,
  type: ActionType,
  input?: unknown,
  output?: unknown,
  durationMs?: number
): void {
  getDataDb().prepare(`
    INSERT INTO actions (id, agent_id, type, input, output, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    agentId,
    type,
    input !== undefined ? JSON.stringify(input) : null,
    output !== undefined ? JSON.stringify(output) : null,
    durationMs ?? null,
    Date.now(),
  );
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function queryActions(params: {
  agentId?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): { items: ActionRow[]; total: number } {
  const db = getDataDb();
  const { agentId, type, search, limit = 50, offset = 0 } = params;

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (agentId) { conditions.push('agent_id = ?'); bindings.push(agentId); }
  if (type)    { conditions.push('type = ?');     bindings.push(type); }
  if (search) {
    conditions.push('(input LIKE ? OR output LIKE ?)');
    const term = `%${search}%`;
    bindings.push(term, term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const items = db.prepare(
    `SELECT * FROM actions ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...bindings, limit, offset) as ActionRow[];

  const { total } = db.prepare(
    `SELECT COUNT(*) as total FROM actions ${where}`
  ).get(...bindings) as { total: number };

  return { items, total };
}
